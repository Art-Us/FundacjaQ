import { redis } from './redis';

const WINDOW_SECONDS = 15 * 60;

function attemptKey(scope: string, id: string): string {
  return `attempts:${scope}:${id}`;
}

function captchaRequiredKey(scope: string, id: string): string {
  return `captcha-required:${scope}:${id}`;
}

/**
 * Increments the attempt counter for (scope, id) and returns the new count.
 * Used to decide when a captcha challenge should kick in — a softer,
 * earlier-triggering signal than the hard rate limiters/lockout.
 *
 * `ttlSeconds` (default: the 15-minute rolling window every existing caller
 * relies on) is how long this counter keeps counting before resetting to
 * zero — pass a longer one for a scope that wants a wider "N attempts within
 * this long" window (see markCaptchaRequired below for the sticky trigger
 * this feeds).
 *
 * Fails open (returns 0, i.e. "no prior attempts") on a Redis error — this
 * only gates whether a captcha is required, not the underlying action, so
 * losing the signal briefly is preferable to crashing the caller.
 */
export async function recordAttempt(scope: string, id: string, ttlSeconds: number = WINDOW_SECONDS): Promise<number> {
  const key = attemptKey(scope, id);
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  } catch (err) {
    console.error(`[attemptTracker] recordAttempt(${scope}) failed, failing open:`, err);
    return 0;
  }
}

/**
 * Whether (scope, id) is currently under a *sticky* captcha requirement —
 * set by markCaptchaRequired below and cleared only by its own TTL expiring,
 * unlike the login/forgot-password captcha gate (which re-derives "required"
 * from the live rolling attempt count on every request, so it can lapse the
 * moment attempts stop coming in). Fails open, same reasoning as
 * getAttemptCount below.
 */
export async function isCaptchaRequired(scope: string, id: string): Promise<boolean> {
  try {
    return (await redis.get(captchaRequiredKey(scope, id))) !== null;
  } catch (err) {
    console.error(`[attemptTracker] isCaptchaRequired(${scope}) failed, failing open:`, err);
    return false;
  }
}

/**
 * Turns on the sticky captcha requirement for (scope, id) for `ttlSeconds`
 * (default 1 hour). Uses NX so a call while it's already active is a no-op —
 * the requirement always expires exactly `ttlSeconds` after it FIRST
 * triggered, never pushed further out by more attempts arriving while it's
 * already in effect.
 *
 * Best-effort: must never throw and block the caller's own intended response.
 */
export async function markCaptchaRequired(scope: string, id: string, ttlSeconds: number = 60 * 60): Promise<void> {
  try {
    await redis.set(captchaRequiredKey(scope, id), '1', 'EX', ttlSeconds, 'NX');
  } catch (err) {
    console.error(`[attemptTracker] markCaptchaRequired(${scope}) failed (non-fatal):`, err);
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
