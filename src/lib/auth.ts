import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from './prisma';
import { verifyPassword } from './password';
import { checkLockout, recordFailedAttempt, resetAttempts } from './lockout';
import { consumeLimit, loginLimiter } from './rateLimit';

const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60; // 8h
const isProd = process.env.NODE_ENV === 'production';

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
      name: isProd ? '__Host-next-auth.session-token' : 'next-auth.session-token',
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
      },
      async authorize(credentials, req) {
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        const ip = getClientIp(req);
        const userAgent = (req?.headers?.['user-agent'] as string) ?? 'unknown';

        if (!email || !password) return null;

        const allowed = await consumeLimit(loginLimiter, `${email}:${ip}`);
        if (!allowed) {
          throw new Error('Za dużo prób logowania. Spróbuj ponownie później.');
        }

        const lockout = await checkLockout(email);
        if (lockout.locked) {
          throw new Error('Konto tymczasowo zablokowane. Spróbuj ponownie później.');
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Same generic failure for "no such user" and "wrong password" so the
        // response never reveals which one it was.
        if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
          await recordFailedAttempt(email);
          await logAttempt(email, user?.id ?? null, false, ip, userAgent);
          throw new Error('Nieprawidłowy email lub hasło.');
        }

        await resetAttempts(email);
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

      if (!dbUser || !dbUser.isActive || passwordChangedAfterIssue || stillLocked) {
        token.invalid = true;
        return token;
      }

      token.role = dbUser.role;
      token.gminaId = dbUser.gminaId;
      token.invalid = false;
      return token;
    },
    async session({ session, token }) {
      if (token.invalid) {
        return { ...session, user: undefined, expires: session.expires };
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
