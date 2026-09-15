import { redis } from './redis';

const WINDOW_SECONDS = 15 * 60;

function attemptKey(scope: string, id: string): string {
  return `attempts:${scope}:${id}`;
}

/**
 * Increments the attempt counter for (scope, id) and returns the new count.
 * Used to decide when a captcha challenge should kick in — a softer,
 * earlier-triggering signal than the hard rate limiters/lockout.
 *
 * Fails open (returns 0, i.e. "no prior attempts") on a Redis error — this
 * only gates whether a captcha is required, not the underlying action, so
 * losing the signal briefly is preferable to crashing the caller.
 */
export async function recordAttempt(scope: string, id: string): Promise<number> {
  const key = attemptKey(scope, id);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, WINDOW_SECONDS);
    }
    return count;
  } catch (err) {
    console.error(`[attemptTracker] recordAttempt(${scope}) failed, failing open:`, err);
    return 0;
  }
}

export async function getAttemptCount(scope: string, id: string): Promise<number> {
  try {
    const raw = await redis.get(attemptKey(scope, id));
    return raw ? Number(raw) : 0;
  } catch (err) {
    console.error(`[attemptTracker] getAttemptCount(${scope}) failed, failing open:`, err);
    return 0;
  }
}

export async function clearAttempts(scope: string, id: string): Promise<void> {
  try {
    await redis.del(attemptKey(scope, id));
  } catch (err) {
    console.error(`[attemptTracker] clearAttempts(${scope}) failed (non-fatal):`, err);
  }
}
