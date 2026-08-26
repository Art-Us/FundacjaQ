import { describe, it, expect, beforeEach } from 'vitest';
import RedisMock from 'ioredis-mock';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { consumeLimit } from './rateLimit';

describe('consumeLimit + RateLimiterRedis (real semantics via ioredis-mock)', () => {
  let client: InstanceType<typeof RedisMock>;
  let limiter: RateLimiterRedis;

  beforeEach(() => {
    client = new RedisMock();
    limiter = new RateLimiterRedis({
      storeClient: client as any,
      keyPrefix: 'test:login',
      points: 5,
      duration: 15 * 60,
      blockDuration: 15 * 60,
    });
  });

  it('allows exactly `points` consumes then rejects the next one', async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(await consumeLimit(limiter, 'attacker@example.com:1.2.3.4'));
    }

    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it('does not extend the block when extra attempts happen while already blocked', async () => {
    const key = 'attacker@example.com:1.2.3.4';

    // Exhaust the limit and trigger the block on the 6th attempt.
    for (let i = 0; i < 6; i++) {
      await consumeLimit(limiter, key);
    }

    const redisKey = `test:login:${key}`;
    const ttlAfterBlock = await client.ttl(redisKey);
    expect(ttlAfterBlock).toBeGreaterThan(0);

    // A handful of further brute-force attempts during the block window.
    for (let i = 0; i < 5; i++) {
      const allowed = await consumeLimit(limiter, key);
      expect(allowed).toBe(false);
    }

    const ttlAfterMoreAttempts = await client.ttl(redisKey);

    // The block's expiry must not have been pushed back by the extra attempts.
    expect(ttlAfterMoreAttempts).toBeLessThanOrEqual(ttlAfterBlock);
    expect(ttlAfterMoreAttempts).toBeGreaterThan(ttlAfterBlock - 5);
  });

  it('tracks separate keys independently (different email+IP does not share a bucket)', async () => {
    for (let i = 0; i < 5; i++) {
      await consumeLimit(limiter, 'victim@example.com:9.9.9.9');
    }
    const stillAllowedForOtherKey = await consumeLimit(limiter, 'someone-else@example.com:8.8.8.8');

    expect(stillAllowedForOtherKey).toBe(true);
  });

  it('returns false (fails closed) if the underlying store rejects', async () => {
    const brokenLimiter = new RateLimiterRedis({
      storeClient: { multi: () => { throw new Error('redis down'); }, defineCommand: () => {} } as any,
      keyPrefix: 'test:broken',
      points: 5,
      duration: 900,
    });

    await expect(consumeLimit(brokenLimiter, 'anyone')).resolves.toBe(false);
  });
});
