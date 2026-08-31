import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./redis');

import { redis } from './redis';
import { checkIpBlock, recordFailedLoginByIp, clearIpFailures } from './ipLockout';

beforeEach(() => {
  vi.mocked(redis.incr).mockReset();
  vi.mocked(redis.expire).mockReset();
  vi.mocked(redis.get).mockReset();
  vi.mocked(redis.set).mockReset();
  vi.mocked(redis.del).mockReset();
});

describe('checkIpBlock', () => {
  it('reports not blocked when there is no block key', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    expect(await checkIpBlock('1.2.3.4')).toEqual({ blocked: false, until: null });
  });

  it('reports blocked while the stored timestamp is in the future', async () => {
    const until = Date.now() + 60_000;
    vi.mocked(redis.get).mockResolvedValue(String(until));

    const result = await checkIpBlock('1.2.3.4');

    expect(result.blocked).toBe(true);
    expect(result.until?.getTime()).toBe(until);
  });

  it('reports not blocked once the stored timestamp is in the past', async () => {
    vi.mocked(redis.get).mockResolvedValue(String(Date.now() - 1000));

    expect((await checkIpBlock('1.2.3.4')).blocked).toBe(false);
  });
});

describe('recordFailedLoginByIp', () => {
  it('does not set a block for counts that are not a multiple of 5', async () => {
    vi.mocked(redis.incr).mockResolvedValue(3);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.expire).toHaveBeenCalledWith('ip-login-fails:1.2.3.4', 24 * 60 * 60);
  });

  it('blocks for 1 minute on the 5th cumulative failure', async () => {
    vi.mocked(redis.incr).mockResolvedValue(5);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).toHaveBeenCalledWith('ip-login-block:1.2.3.4', expect.any(Number), 'EX', 60);
  });

  it('blocks for 5 minutes on the 10th cumulative failure', async () => {
    vi.mocked(redis.incr).mockResolvedValue(10);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).toHaveBeenCalledWith('ip-login-block:1.2.3.4', expect.any(Number), 'EX', 5 * 60);
  });

  it('blocks for 15 minutes on the 15th cumulative failure', async () => {
    vi.mocked(redis.incr).mockResolvedValue(15);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).toHaveBeenCalledWith('ip-login-block:1.2.3.4', expect.any(Number), 'EX', 15 * 60);
  });

  it('blocks for 30 minutes on the 20th cumulative failure', async () => {
    vi.mocked(redis.incr).mockResolvedValue(20);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).toHaveBeenCalledWith('ip-login-block:1.2.3.4', expect.any(Number), 'EX', 30 * 60);
  });

  it('keeps repeating the 30-minute block for every further multiple of 5 past the 20th', async () => {
    vi.mocked(redis.incr).mockResolvedValue(35);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.set).toHaveBeenCalledWith('ip-login-block:1.2.3.4', expect.any(Number), 'EX', 30 * 60);
  });

  it('renews the 24h counter TTL on every failure (sliding window)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(7);

    await recordFailedLoginByIp('1.2.3.4');

    expect(redis.expire).toHaveBeenCalledWith('ip-login-fails:1.2.3.4', 24 * 60 * 60);
  });
});

describe('clearIpFailures', () => {
  it('deletes both the failure counter and any active block', async () => {
    await clearIpFailures('1.2.3.4');

    expect(redis.del).toHaveBeenCalledWith('ip-login-fails:1.2.3.4');
    expect(redis.del).toHaveBeenCalledWith('ip-login-block:1.2.3.4');
  });
});