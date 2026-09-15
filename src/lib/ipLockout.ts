import { redis } from './redis';
import { blockSecondsForCount } from './escalatingBlock';

// The cumulative wrong-password count for an IP slides forward 24h on every
// new failure, so an IP that stays clean for a full day starts over at zero.
const COUNTER_TTL_SECONDS = 24 * 60 * 60;

function counterKey(ip: string): string {
  return `ip-login-fails:${ip}`;
}

function blockKey(ip: string): string {
  return `ip-login-block:${ip}`;
}

export const IP_BLOCKED_MESSAGE =
  'Zbyt wiele nieudanych prób logowania z tego adresu IP. Spróbuj ponownie później.';

export interface IpBlockStatus {
  blocked: boolean;
  until: Date | null;
}

/**
 * Blocks login, invite acceptance, and password-reset requests from this IP.
 * Fails open (reports "not blocked") on a Redis error, logging it instead —
 * this is a secondary abuse-throttle on top of the actual credential check,
 * so losing it briefly during a Redis blip is far preferable to it taking
 * login itself down for everyone.
 */
export async function checkIpBlock(ip: string): Promise<IpBlockStatus> {
  let raw: string | null;
  try {
    raw = await redis.get(blockKey(ip));
  } catch (err) {
    console.error('[ipLockout] checkIpBlock failed, failing open:', err);
    return { blocked: false, until: null };
  }
  if (!raw) return { blocked: false, until: null };

  const until = new Date(Number(raw));
  if (until.getTime() <= Date.now()) return { blocked: false, until: null };
  return { blocked: true, until };
}

/** Records a wrong login password from this IP, regardless of which account was targeted. */
export async function recordFailedLoginByIp(ip: string): Promise<void> {
  // Best-effort: must never throw and mask the caller's own intended response.
  try {
    const count = await redis.incr(counterKey(ip));
    await redis.expire(counterKey(ip), COUNTER_TTL_SECONDS);

    const blockSeconds = blockSecondsForCount(count);
    if (blockSeconds !== null) {
      const until = Date.now() + blockSeconds * 1000;
      await redis.set(blockKey(ip), until, 'EX', blockSeconds);
    }
  } catch (err) {
    console.error('[ipLockout] recordFailedLoginByIp failed (non-fatal):', err);
  }
}

/**
 * Clears this IP's cumulative failure count and any active block. Called on
 * a successful login — by product decision, proving you know a real
 * password wipes this IP's slate clean, even though on a shared IP (office
 * NAT, VPN exit) that could also erase an unrelated attacker's progress.
 *
 * Best-effort: must never throw and block an already-authenticated user from
 * completing sign-in.
 */
export async function clearIpFailures(ip: string): Promise<void> {
  try {
    await Promise.all([redis.del(counterKey(ip)), redis.del(blockKey(ip))]);
  } catch (err) {
    console.error('[ipLockout] clearIpFailures failed (non-fatal):', err);
  }
}
