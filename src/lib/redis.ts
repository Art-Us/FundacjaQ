import Redis from 'ioredis';

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// A listener is required on 'error' — Node's EventEmitter rethrows an
// unhandled 'error' event as an uncaught exception, which would crash the
// process on any transient connection issue (ioredis retries reconnecting
// on its own regardless). Attached only when actually creating the client,
// not when reusing the one stashed on globalThis, so a dev hot-reload
// doesn't pile up duplicate listeners on the same instance.
function createRedisClient(): Redis {
  const client = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    // Without these, ioredis's defaults (10s connectTimeout, no commandTimeout)
    // mean a network-partition-style outage (host unreachable, packets
    // silently dropped — as opposed to a cleanly refused connection) makes
    // every single command hang for tens of seconds before rejecting, once
    // per retry — measured at ~40s worst case with the default
    // maxRetriesPerRequest, vs ~300ms for a cleanly refused connection.
    // Every caller here (lib/userStatusCache.ts, lib/alertAccessCache.ts,
    // lib/resourceAccessCache.ts, lib/lockout.ts, etc.) already treats a
    // rejected Redis call as "fall back to Postgres" — these bounds just make
    // sure that fallback actually happens fast instead of after a minute-plus
    // hang per request.
    connectTimeout: 2000,
    commandTimeout: 1000,
    // A full outage (host down/unreachable, not just a refused connection)
    // used to cost every caller a full connectTimeout-bounded retry cycle
    // PER COMMAND: ioredis queues commands issued while disconnected and only
    // rejects them once maxRetriesPerRequest reconnect attempts have failed.
    // authorize() in lib/auth.ts fires 4 of these sequentially per login
    // (checkIpBlock, checkLoginPairBlock, checkLockout, getAttemptCount) — at
    // 3 retries each that stacked into several seconds of dead time per
    // command, tens of seconds for one login request. With the offline queue
    // disabled, a command issued while the client isn't 'ready' rejects
    // immediately instead of queueing/retrying — only the first command to
    // notice a fresh outage still pays a connect/command-timeout-bounded
    // wait, every command after it (same request or the next, until Redis
    // recovers) fails instantly. maxRetriesPerRequest still applies to a
    // command sent on a connection that's technically up but not responding,
    // so it's dropped from 3 to 1 to keep that path just as fast.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });
  client.on('error', (err) => console.error('[redis] connection error:', err));
  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
