import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { consumeLimit, passwordResetLimiter } from '@/lib/rateLimit';
import { resetAttempts } from '@/lib/lockout';

export const runtime = 'nodejs';

const bodySchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane.' }, { status: 400 });
  }
  const { token, password } = parsed.data;
  const ip = getClientIp(req);

  const allowed = await consumeLimit(passwordResetLimiter, `reset:${ip}`);
  if (!allowed) {
    return NextResponse.json({ error: 'Za dużo prób. Spróbuj ponownie później.' }, { status: 429 });
  }

  const tokenHash = hashToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  const invalidResponse = NextResponse.json({ error: 'Link jest nieprawidłowy lub wygasł.' }, { status: 400 });

  if (!resetToken || resetToken.usedAt || resetToken.expiresAt.getTime() < Date.now()) {
    return invalidResponse;
  }

  if (await isPasswordPwned(password)) {
    return NextResponse.json(
      { error: 'To hasło znajduje się w publicznych bazach wycieków. Wybierz inne.' },
      { status: 400 }
    );
  }

  const passwordHash = await hashPassword(password);

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count === 0) return false;

    await tx.user.update({
      where: { id: resetToken.userId },
      data: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
    });
    return true;
  });

  if (!updated) {
    return invalidResponse;
  }

  await resetAttempts(resetToken.user.email);

  return NextResponse.json({ message: 'Hasło zostało zmienione. Możesz się zalogować.' });
}
