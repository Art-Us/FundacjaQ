import { redis } from './redis';

const WINDOW_SECONDS = 15 * 60;

function attemptKey(scope: string, id: string): string {
  return `attempts:${scope}:${id}`;
}

/**
 * Increments the attempt counter for (scope, id) and returns the new count.
 * Used to decide when a captcha challenge should kick in — a softer,
 * earlier-triggering signal than the hard rate limiters/lockout.
 */
export async function recordAttempt(scope: string, id: string): Promise<number> {
  const key = attemptKey(scope, id);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  return count;
}

export async function getAttemptCount(scope: string, id: string): Promise<number> {
  const raw = await redis.get(attemptKey(scope, id));
  return raw ? Number(raw) : 0;
}

export async function clearAttempts(scope: string, id: string): Promise<void> {
  await redis.del(attemptKey(scope, id));
}