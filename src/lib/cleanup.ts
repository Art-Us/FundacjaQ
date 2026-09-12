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

export async function runRetentionCleanup(): Promise<void> {
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
}
