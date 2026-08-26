import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateToken, hashToken, RESET_TOKEN_TTL_MS } from '@/lib/tokens';
import { sendPasswordResetEmail } from '@/lib/email';
import { consumeLimit, passwordResetLimiter } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const bodySchema = z.object({ email: z.string().email() });

function genericResponse() {
  return NextResponse.json({
    message: 'Jeśli podany adres istnieje w systemie, wysłaliśmy na niego link do resetu hasła.',
  });
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nieprawidłowe dane.' }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase().trim();
  const ip = getClientIp(req);

  // Rate-limited by IP+email either way, and the response is identical
  // whether or not the account exists, to prevent email enumeration.
  const allowed = await consumeLimit(passwordResetLimiter, `${email}:${ip}`);
  if (!allowed) {
    return genericResponse();
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return genericResponse();
  }

  const rawToken = generateToken();
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password/${rawToken}`;
  await sendPasswordResetEmail(user.email, resetUrl);

  return genericResponse();
}
