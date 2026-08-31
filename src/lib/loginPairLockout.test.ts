import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./redis');

import { redis } from './redis';
import { checkLoginPairBlock, recordFailedLoginPair, clearLoginPairFailures } from './loginPairLockout';

const EMAIL = 'user@example.com';
const IP = '1.2.3.4';

beforeEach(() => {
  vi.mocked(redis.incr).mockReset();
  vi.mocked(redis.expire).mockReset();
  vi.mocked(redis.get).mockReset();
  vi.mocked(redis.set).mockReset();
  vi.mocked(redis.del).mockReset();
});

describe('checkLoginPairBlock', () => {
  it('reports not blocked when there is no block key', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    expect(await checkLoginPairBlock(EMAIL, IP)).toEqual({ blocked: false, until: null });
  });

  it('reports blocked while the stored timestamp is in the future', async () => {
    const until = Date.now() + 60_000;
    vi.mocked(redis.get).mockResolvedValue(String(until));

    const result = await checkLoginPairBlock(EMAIL, IP);

    expect(result.blocked).toBe(true);
    expect(result.until?.getTime()).toBe(until);
  });

  it('reports not blocked once the stored timestamp is in the past', async () => {
    vi.mocked(redis.get).mockResolvedValue(String(Date.now() - 1000));

    expect((await checkLoginPairBlock(EMAIL, IP)).blocked).toBe(false);
  });
});

describe('recordFailedLoginPair', () => {
  it('does not set a block for counts that are not a multiple of 5', async () => {
    vi.mocked(redis.incr).mockResolvedValue(3);

    await recordFailedLoginPair(EMAIL, IP);

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalledWith(`login-pair-fails:${EMAIL}:${IP}`, 24 * 60 * 60);
  });

  it('blocks for 1 minute on the 5th cumulative failure', async () => {
    vi.mocked(redis.incr).mockResolvedValue(5);

    await recordFailedLoginPair(EMAIL, IP);

    expect(redis.set).toHaveBeenCalledWith(`login-pair-block:${EMAIL}:${IP}`, expect.any(Number), 'EX', 60);
  });

  it('blocks for 30 minutes on the 20th cumulative failure and every 5 after', async () => {
    vi.mocked(redis.incr).mockResolvedValue(20);
    await recordFailedLoginPair(EMAIL, IP);
    expect(redis.set).toHaveBeenLastCalledWith(`login-pair-block:${EMAIL}:${IP}`, expect.any(Number), 'EX', 30 * 60);

    vi.mocked(redis.incr).mockResolvedValue(35);
    await recordFailedLoginPair(EMAIL, IP);
    expect(redis.set).toHaveBeenLastCalledWith(`login-pair-block:${EMAIL}:${IP}`, expect.any(Number), 'EX', 30 * 60);
  });

  it('tracks each (email, ip) pair independently', async () => {
    vi.mocked(redis.incr).mockResolvedValue(5);

    await recordFailedLoginPair('other@example.com', IP);

    expect(redis.expire).toHaveBeenCalledWith(`login-pair-fails:other@example.com:${IP}`, 24 * 60 * 60);
  });
});

describe('clearLoginPairFailures', () => {
  it('deletes both the failure counter and any active block for this pair', async () => {
    await clearLoginPairFailures(EMAIL, IP);

    expect(redis.del).toHaveBeenCalledWith(`login-pair-fails:${EMAIL}:${IP}`);
    expect(redis.del).toHaveBeenCalledWith(`login-pair-block:${EMAIL}:${IP}`);
  });
});