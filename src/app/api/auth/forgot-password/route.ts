import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateToken, hashToken, RESET_TOKEN_TTL_MS } from '@/lib/tokens';
import { sendPasswordResetEmail } from '@/lib/email';
import { consumeLimit, passwordResetLimiter, passwordResetPerAccountLimiter } from '@/lib/rateLimit';
import { getAttemptCount, recordAttempt } from '@/lib/attemptTracker';
import { verifyCaptcha } from '@/lib/captcha';
import { checkIpBlock, IP_BLOCKED_MESSAGE } from '@/lib/ipLockout';

export const runtime = 'nodejs';

const bodySchema = z.object({ email: z.string().email(), captchaToken: z.string().optional() });

// Lower than the hard rate limits (5/hour per IP+email, 10/hour per email) so
// a script gets challenged well before it could exhaust either of them.
const CAPTCHA_ACCOUNT_ATTEMPT_THRESHOLD = 2;
const CAPTCHA_IP_ATTEMPT_THRESHOLD = 3;

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

  // An IP escalating-blocked for too many wrong login passwords (see
  // ipLockout.ts) is locked out of this action too, not just login.
  const ipBlock = await checkIpBlock(ip);
  if (ipBlock.blocked) {
    return NextResponse.json({ error: IP_BLOCKED_MESSAGE }, { status: 429 });
  }

  // Rate-limited both by IP+email and by email alone, and the response is
  // identical whether or not the account exists, to prevent email
  // enumeration. The email-only limiter stops an attacker from rotating IPs
  // to flood a victim's inbox with reset emails past the per-IP limit.
  const allowedByIp = await consumeLimit(passwordResetLimiter, `${email}:${ip}`);
  const allowedByAccount = await consumeLimit(passwordResetPerAccountLimiter, email);
  if (!allowedByIp || !allowedByAccount) {
    return genericResponse();
  }

  // Captcha decision is based on attempts made *before* this one, so every
  // request (regardless of outcome) still counts toward it below.
  const [accountAttempts, ipAttempts] = await Promise.all([
    getAttemptCount('pwd-reset-account', email),
    getAttemptCount('pwd-reset-ip', ip),
  ]);
  const captchaRequired =
    accountAttempts >= CAPTCHA_ACCOUNT_ATTEMPT_THRESHOLD || ipAttempts >= CAPTCHA_IP_ATTEMPT_THRESHOLD;

  await Promise.all([recordAttempt('pwd-reset-account', email), recordAttempt('pwd-reset-ip', ip)]);

  // Unlike account existence, "you've made several requests recently" is
  // safe to reveal honestly — it doesn't depend on whether the email exists.
  if (captchaRequired && !(await verifyCaptcha(parsed.data.captchaToken, ip))) {
    return NextResponse.json(
      { error: 'Zbyt wiele prób. Potwierdź, że nie jesteś robotem.', captchaRequired: true },
      { status: 400 }
    );
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