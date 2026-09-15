import { prisma } from './prisma';

const LOGIN_ATTEMPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const STALE_TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days past expiry
// Audit log rows carry no revert-chain guarantee past this point: deleting an
// old row that a newer row's `revertOfId` points at just SETS NULL on that
// link (see the `AuditLog_revertOfId_fkey` migration) rather than failing, so
// this is safe to run unconditionally — it just means an action older than
// this can no longer be reverted, and any newer revert-of-it shows as a
// standalone entry instead of a linked one. That tradeoff is intentional.
const AUDIT_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Arbitrary, stable across deploys — a Postgres advisory lock key, not a
// row/entity id. instrumentation.ts's register() schedules this cron job in
// EVERY server process, so on a horizontally-scaled deployment every
// instance would otherwise run the exact same deletes at 03:00 daily. The
// deletes are individually idempotent so that's not a correctness bug, just
// redundant DB load — this lock makes only one instance actually do the work
// each run, with the rest exiting immediately.
const RETENTION_LOCK_KEY = 7_291_045;

export async function runRetentionCleanup(): Promise<void> {
  const [{ locked }] = await prisma.$queryRaw<
    [{ locked: boolean }]
  >`SELECT pg_try_advisory_lock(${RETENTION_LOCK_KEY}) AS locked`;
  if (!locked) {
    console.log('[cleanup] another instance already holds the retention lock, skipping this run');
    return;
  }

  try {
    const loginAttemptCutoff = new Date(Date.now() - LOGIN_ATTEMPT_RETENTION_MS);
    const tokenCutoff = new Date(Date.now() - STALE_TOKEN_RETENTION_MS);
    const auditLogCutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_MS);

    const [loginAttempts, inviteTokens, resetTokens, auditLogs] = await Promise.all([
      prisma.loginAttempt.deleteMany({
        where: { createdAt: { lt: loginAttemptCutoff } },
      }),
      prisma.inviteToken.deleteMany({
        where: { expiresAt: { lt: tokenCutoff } },
      }),
      prisma.passwordResetToken.deleteMany({
        where: { expiresAt: { lt: tokenCutoff } },
      }),
      prisma.auditLog.deleteMany({
        where: { createdAt: { lt: auditLogCutoff } },
      }),
    ]);

    console.log(
      `[cleanup] removed ${loginAttempts.count} login attempts, ${inviteTokens.count} invite tokens, ${resetTokens.count} reset tokens, ${auditLogs.count} audit log entries`
    );
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${RETENTION_LOCK_KEY})`;
  }
}
