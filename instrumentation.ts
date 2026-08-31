export async function register() {
  // Only the long-lived Node.js server process should run the cron job, not
  // the Edge runtime or the build-time compilation pass.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const cron = await import('node-cron');
  const { runRetentionCleanup } = await import('./src/lib/cleanup');

  cron.schedule('0 3 * * *', () => {
    runRetentionCleanup().catch((err) => console.error('[cleanup] failed:', err));
  });
}
