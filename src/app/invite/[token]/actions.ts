'use server';

import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { consumeLimit, inviteAcceptLimiter } from '@/lib/rateLimit';

export interface AcceptInviteResult {
  ok: boolean;
  error?: string;
}

function getClientIp(): string {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function acceptInvite(rawToken: string, password: string, confirmPassword: string): Promise<AcceptInviteResult> {
  const ip = getClientIp();

  const allowed = await consumeLimit(inviteAcceptLimiter, `${rawToken}:${ip}`);
  if (!allowed) {
    return { ok: false, error: 'Za dużo prób. Spróbuj ponownie później.' };
  }

  if (password !== confirmPassword) {
    return { ok: false, error: 'Hasła nie są identyczne.' };
  }

  const passwordCheck = passwordSchema.safeParse(password);
  if (!passwordCheck.success) {
    return { ok: false, error: passwordCheck.error.issues[0]?.message ?? 'Nieprawidłowe hasło.' };
  }

  const tokenHash = hashToken(rawToken);
  const invite = await prisma.inviteToken.findUnique({ where: { tokenHash } });

  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'Link zaproszenia jest nieprawidłowy lub wygasł.' };
  }

  if (await isPasswordPwned(password)) {
    return { ok: false, error: 'To hasło znajduje się w publicznych bazach wycieków. Wybierz inne.' };
  }

  const existing = await prisma.user.findUnique({ where: { email: invite.email } });
  if (existing) {
    return { ok: false, error: 'Konto dla tego adresu email już istnieje.' };
  }

  const passwordHash = await hashPassword(password);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const result = await tx.inviteToken.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (result.count === 0) return false;

      await tx.user.create({
        data: {
          email: invite.email,
          role: invite.role,
          gminaId: invite.gminaId,
          passwordHash,
          emailVerified: new Date(),
          isActive: true,
        },
      });
      return true;
    });

    if (!created) {
      return { ok: false, error: 'Link zaproszenia został już wykorzystany.' };
    }
  } catch {
    return { ok: false, error: 'Konto dla tego adresu email już istnieje.' };
  }

  return { ok: true };
}
