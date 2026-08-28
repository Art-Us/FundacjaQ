'use server';

import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/tokens';
import { hashPassword, isPasswordPwned, passwordSchema } from '@/lib/password';
import { consumeLimit, inviteAcceptLimiter } from '@/lib/rateLimit';
import { getAttemptCount, recordAttempt } from '@/lib/attemptTracker';
import { verifyCaptcha } from '@/lib/captcha';
import { checkIpBlock, IP_BLOCKED_MESSAGE } from '@/lib/ipLockout';

export interface AcceptInviteResult {
  ok: boolean;
  error?: string;
  captchaRequired?: boolean;
}

// Lower than the hard rate limit (10 accept attempts/hour per token+IP) so a
// script gets challenged well before it could exhaust it.
const CAPTCHA_TOKEN_ATTEMPT_THRESHOLD = 2;
const CAPTCHA_IP_ATTEMPT_THRESHOLD = 3;

function getClientIp(): string {
  return headers().get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function acceptInvite(
  rawToken: string,
  password: string,
  confirmPassword: string,
  captchaToken?: string
): Promise<AcceptInviteResult> {
  const ip = getClientIp();

  // An IP escalating-blocked for too many wrong login passwords (see
  // ipLockout.ts) is locked out of this action too, not just login.
  const ipBlock = await checkIpBlock(ip);
  if (ipBlock.blocked) {
    return { ok: false, error: IP_BLOCKED_MESSAGE };
  }

  const allowed = await consumeLimit(inviteAcceptLimiter, `${rawToken}:${ip}`);
  if (!allowed) {
    return { ok: false, error: 'Za dużo prób. Spróbuj ponownie później.' };
  }

  // Track by the token's hash (not the raw token) so it doubles as the
  // "account" identity here — there's no user yet to key on.
  const tokenId = hashToken(rawToken);
  const [tokenAttempts, ipAttempts] = await Promise.all([
    getAttemptCount('invite-accept-token', tokenId),
    getAttemptCount('invite-accept-ip', ip),
  ]);
  const captchaRequired =
    tokenAttempts >= CAPTCHA_TOKEN_ATTEMPT_THRESHOLD || ipAttempts >= CAPTCHA_IP_ATTEMPT_THRESHOLD;

  await Promise.all([recordAttempt('invite-accept-token', tokenId), recordAttempt('invite-accept-ip', ip)]);

  if (captchaRequired && !(await verifyCaptcha(captchaToken, ip))) {
    return { ok: false, error: 'Zbyt wiele prób. Potwierdź, że nie jesteś robotem.', captchaRequired: true };
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