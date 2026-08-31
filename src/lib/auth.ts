import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from './prisma';
import { verifyPassword, DUMMY_PASSWORD_HASH } from './password';
import { checkLockout, recordFailedAttempt, resetAttempts } from './lockout';
import { checkIpBlock, recordFailedLoginByIp, clearIpFailures, IP_BLOCKED_MESSAGE } from './ipLockout';
import {
  checkLoginPairBlock,
  recordFailedLoginPair,
  clearLoginPairFailures,
  LOGIN_PAIR_BLOCKED_MESSAGE,
} from './loginPairLockout';
import { getAttemptCount, recordAttempt, clearAttempts } from './attemptTracker';
import { verifyCaptcha } from './captcha';
import { SESSION_COOKIE_NAME } from './sessionCookie';

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h
const isProd = process.env.NODE_ENV === 'production';

// A softer, earlier nudge than the 20-attempt/1h account lockout in
// lockout.ts — this challenges a script before it ever reaches that wall.
const CAPTCHA_ACCOUNT_ATTEMPT_THRESHOLD = 3;

function getClientIp(req: { headers?: Record<string, string | string[] | undefined> } | undefined): string {
  const forwarded = req?.headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return raw?.split(',')[0]?.trim() ?? 'unknown';
}

async function logAttempt(
  email: string,
  userId: string | null,
  success: boolean,
  ipAddress: string,
  userAgent: string
): Promise<void> {
  await prisma.loginAttempt
    .create({ data: { email, userId, success, ipAddress, userAgent } })
    .catch((err) => console.error('[auth] failed to log login attempt:', err));
}

async function recordFailure(email: string, userId: string | null, ip: string, userAgent: string): Promise<void> {
  await Promise.all([
    recordFailedAttempt(email),
    recordAttempt('login-account', email),
    recordFailedLoginByIp(ip),
    recordFailedLoginPair(email, ip),
    logAttempt(email, userId, false, ip, userAgent),
  ]);
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: {
    signIn: '/login',
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProd,
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        captchaToken: { label: 'Captcha', type: 'text' },
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        const captchaToken = credentials?.captchaToken;
        const ip = getClientIp(req);
        const userAgent = (req?.headers?.['user-agent'] as string) ?? 'unknown';

        if (!email || !password) return null;

        const ipBlock = await checkIpBlock(ip);
        if (ipBlock.blocked) {
          throw new Error(IP_BLOCKED_MESSAGE);
        }

        const pairBlock = await checkLoginPairBlock(email, ip);
        if (pairBlock.blocked) {
          throw new Error(LOGIN_PAIR_BLOCKED_MESSAGE);
        }

        const lockout = await checkLockout(email);
        if (lockout.locked) {
          throw new Error('Konto tymczasowo zablokowane. Spróbuj ponownie później.');
        }

        const accountAttempts = await getAttemptCount('login-account', email);
        const captchaRequired = accountAttempts >= CAPTCHA_ACCOUNT_ATTEMPT_THRESHOLD;

        if (captchaRequired && !(await verifyCaptcha(captchaToken, ip))) {
          await recordFailure(email, null, ip, userAgent);
          // Distinct sentinel (not a Polish message) so the client can
          // reliably detect this case and render the captcha widget, without
          // it doubling as a user-facing string.
          throw new Error('CAPTCHA_REQUIRED');
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Always run bcrypt, even for a nonexistent user (against a dummy
        // hash), so the response time doesn't leak whether the account
        // exists. Same generic failure for "no such user" and "wrong
        // password" so the message doesn't reveal which one it was either.
        const validPassword = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
        if (!user || !user.isActive || !validPassword) {
          await recordFailure(email, user?.id ?? null, ip, userAgent);
          throw new Error('Nieprawidłowy email lub hasło.');
        }

        await resetAttempts(email);
        await clearAttempts('login-account', email);
        await clearIpFailures(ip);
        await clearLoginPairFailures(email, ip);
        await logAttempt(email, user.id, true, ip, userAgent);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          gminaId: user.gminaId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.gminaId = user.gminaId;
        token.invalid = false;
        return token;
      }

      // Re-validate on every session check so a deactivated account or a
      // password reset kills the session within one round trip, without
      // needing a separate refresh-token/revocation-list system.
      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub },
        select: { isActive: true, lockedUntil: true, passwordChangedAt: true, role: true, gminaId: true },
      });

      const issuedAtMs = typeof token.iat === 'number' ? token.iat * 1000 : 0;
      const passwordChangedAfterIssue = dbUser ? dbUser.passwordChangedAt.getTime() > issuedAtMs : true;
      const stillLocked = dbUser?.lockedUntil ? dbUser.lockedUntil.getTime() > Date.now() : false;

      // Distinguished from the other invalidation causes (stale password, temporary
      // lockout) so the client can show "your account was deactivated, contact an
      // admin" specifically for this one, rather than a generic session-expired redirect.
      if (!dbUser || !dbUser.isActive) {
        token.invalid = true;
        token.invalidReason = 'deactivated';
        return token;
      }

      if (passwordChangedAfterIssue || stillLocked) {
        token.invalid = true;
        token.invalidReason = 'stale';
        return token;
      }

      token.role = dbUser.role;
      token.gminaId = dbUser.gminaId;
      token.invalid = false;
      return token;
    },
    async session({ session, token }) {
      if (token.invalid) {
        return { ...session, user: undefined, blocked: token.invalidReason === 'deactivated', expires: session.expires };
      }
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as string;
        session.user.gminaId = token.gminaId as string | null;
      }
      return session;
    },
  },
};