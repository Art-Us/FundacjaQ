import { prisma } from './prisma';

const LOGIN_ATTEMPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const STALE_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days past expiry

export async function runRetentionCleanup(): Promise<void> {
  const loginAttemptCutoff = new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_MS);
  const tokenCutoff = new Date(Date.now() - STALE_TOKEN_RETENTION_MS);

  const [loginAttempts, inviteTokens, resetTokens] = await Promise.all([
    prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: loginAttemptCutoff } },
    }),
    prisma.inviteToken.deleteMany({
      where: { expiresAt: { lt: tokenCutoff } },
    }),
    prisma.passwordResetToken.deleteMany({
      where: { expiresAt: { lt: tokenCutoff } },
    }),
  ]);

  console.log(
    `[cleanup] removed ${loginAttempts.count} login attempts, ${inviteTokens.count} invite tokens, ${resetTokens.count} reset tokens`
  );
}
