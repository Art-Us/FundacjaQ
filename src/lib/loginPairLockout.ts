import { redis } from './redis';
import { blockSecondsForCount } from './escalatingBlock';

// Same 24h sliding decay as the IP-wide block: a pair that stays clean for a
// full day starts over at zero.
const COUNTER_TTL_SECONDS = 24 * 60 * 60;

function counterKey(email: string, ip: string): string {
  return `login-pair-fails:${email}:${ip}`;
}

function blockKey(email: string, ip: string): string {
  return `login-pair-block:${email}:${ip}`;
}

export const LOGIN_PAIR_BLOCKED_MESSAGE = 'Za dużo prób logowania. Spróbuj ponownie później.';

export interface LoginPairBlockStatus {
  blocked: boolean;
  until: Date | null;
}

/**
 * Escalating block for one specific (email, IP) pair — same tiers as the
 * IP-wide block, but scoped to "this person trying this exact account",
 * so it can be much stricter without punishing everyone else on a shared IP.
 *
 * Fails open (reports "not blocked") on a Redis error, logging it instead —
 * this is a secondary abuse-throttle on top of the actual credential check,
 * so losing it briefly during a Redis blip is far preferable to it taking
 * login itself down for everyone.
 */
export async function checkLoginPairBlock(email: string, ip: string): Promise<LoginPairBlockStatus> {
  let raw: string | null;
  try {
    raw = await redis.get(blockKey(email, ip));
  } catch (err) {
    console.error('[loginPairLockout] checkLoginPairBlock failed, failing open:', err);
    return { blocked: false, until: null };
  }
  if (!raw) return { blocked: false, until: null };

  const until = new Date(Number(raw));
  if (until.getTime() <= Date.now()) return { blocked: false, until: null };
  return { blocked: true, until };
}

/** Best-effort: must never throw and mask the caller's own intended response. */
export async function recordFailedLoginPair(email: string, ip: string): Promise<void> {
  try {
    const count = await redis.incr(counterKey(email, ip));
    await redis.expire(counterKey(email, ip), COUNTER_TTL_SECONDS);

    const blockSeconds = blockSecondsForCount(count);
    if (blockSeconds !== null) {
      const until = Date.now() + blockSeconds * 1000;
      await redis.set(blockKey(email, ip), until, 'EX', blockSeconds);
    }
  } catch (err) {
    console.error('[loginPairLockout] recordFailedLoginPair failed (non-fatal):', err);
  }
}

/**
 * Clears this pair's cumulative failure count and any active block. Called
 * on a successful login. Best-effort: must never throw and block an
 * already-authenticated user from completing sign-in.
 */
export async function clearLoginPairFailures(email: string, ip: string): Promise<void> {
  try {
    await Promise.all([redis.del(counterKey(email, ip)), redis.del(blockKey(email, ip))]);
  } catch (err) {
    console.error('[loginPairLockout] clearLoginPairFailures failed (non-fatal):', err);
  }
}
