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
    maxRetriesPerRequest: 3,
    // Without these, ioredis's defaults (10s connectTimeout, no commandTimeout)
    // mean a network-partition-style outage (host unreachable, packets
    // silently dropped — as opposed to a cleanly refused connection) makes
    // every single command hang for tens of seconds before rejecting, once
    // per retry — measured at ~40s worst case with the default
    // maxRetriesPerRequest above, vs ~300ms for a cleanly refused connection.
    // Every caller here (lib/userStatusCache.ts, lib/alertAccessCache.ts,
    // lib/resourceAccessCache.ts, lib/lockout.ts, etc.) already treats a
    // rejected Redis call as "fall back to Postgres" — these bounds just make
    // sure that fallback actually happens fast instead of after a minute-plus
    // hang per request.
    connectTimeout: 2000,
    commandTimeout: 1000,
  });
  client.on('error', (err) => console.error('[redis] connection error:', err));
  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
