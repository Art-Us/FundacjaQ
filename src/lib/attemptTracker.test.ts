import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./redis');

import { redis } from './redis';
import { recordAttempt, getAttemptCount, clearAttempts } from './attemptTracker';

beforeEach(() => {
  vi.mocked(redis.incr).mockReset();
  vi.mocked(redis.expire).mockReset();
  vi.mocked(redis.get).mockReset();
  vi.mocked(redis.del).mockReset();
});

describe('recordAttempt', () => {
  it('increments the counter and sets an expiry on the first attempt in the window', async () => {
    vi.mocked(redis.incr).mockResolvedValue(1);

    const count = await recordAttempt('login-account', 'user@example.com');

    expect(count).toBe(1);
    expect(redis.incr).toHaveBeenCalledWith('attempts:login-account:user@example.com');
    expect(redis.expire).toHaveBeenCalledWith('attempts:login-account:user@example.com', expect.any(Number));
  });

  it('does not re-set the expiry on subsequent attempts (keeps the original window)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(2);

    await recordAttempt('login-account', 'user@example.com');

    expect(redis.expire).not.toHaveBeenCalled();
  });
});

describe('getAttemptCount', () => {
  it('returns 0 when no attempts have been recorded', async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    expect(await getAttemptCount('login-ip', '1.2.3.4')).toBe(0);
  });

  it('returns the stored count', async () => {
    vi.mocked(redis.get).mockResolvedValue('4');

    expect(await getAttemptCount('login-ip', '1.2.3.4')).toBe(4);
  });
});

describe('clearAttempts', () => {
  it('deletes the counter key', async () => {
    await clearAttempts('login-account', 'user@example.com');

    expect(redis.del).toHaveBeenCalledWith('attempts:login-account:user@example.com');
  });
});