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
  });
  client.on('error', (err) => console.error('[redis] connection error:', err));
  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;
