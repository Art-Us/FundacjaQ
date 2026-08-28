import { redis } from './redis';

// The cumulative wrong-password count for an IP slides forward 24h on every
// new failure, so an IP that stays clean for a full day starts over at zero.
const COUNTER_TTL_SECONDS = 24 * 60 * 60;

// Every 5th cumulative wrong password from this IP (across any account it
// targets) re-triggers a block, escalating 1min -> 5min -> 15min -> 30min.
// Past the last tier, every further multiple of 5 repeats the 30min block.
const ATTEMPTS_PER_TIER = 5;
const TIER_BLOCK_SECONDS = [60, 5 * 60, 15 * 60, 30 * 60];

function counterKey(ip: string): string {
  return `ip-login-fails:${ip}`;
}

function blockKey(ip: string): string {
  return `ip-login-block:${ip}`;
}

function blockSecondsForCount(count: number): number | null {
  if (count === 0 || count % ATTEMPTS_PER_TIER !== 0) return null;
  const tierIndex = count / ATTEMPTS_PER_TIER - 1;
  return TIER_BLOCK_SECONDS[Math.min(tierIndex, TIER_BLOCK_SECONDS.length - 1)];
}

export const IP_BLOCKED_MESSAGE =
  'Zbyt wiele nieudanych prób logowania z tego adresu IP. Spróbuj ponownie później.';

export interface IpBlockStatus {
  blocked: boolean;
  until: Date | null;
}

/** Blocks login, invite acceptance, and password-reset requests from this IP. */
export async function checkIpBlock(ip: string): Promise<IpBlockStatus> {
  const raw = await redis.get(blockKey(ip));
  if (!raw) return { blocked: false, until: null };

  const until = new Date(Number(raw));
  if (until.getTime() <= Date.now()) return { blocked: false, until: null };
  return { blocked: true, until };
}

/** Records a wrong login password from this IP, regardless of which account was targeted. */
export async function recordFailedLoginByIp(ip: string): Promise<void> {
  const count = await redis.incr(counterKey(ip));
  await redis.expire(counterKey(ip), COUNTER_TTL_SECONDS);

  const blockSeconds = blockSecondsForCount(count);
  if (blockSeconds !== null) {
    const until = Date.now() + blockSeconds * 1000;
    await redis.set(blockKey(ip), until, 'EX', blockSeconds);
  }
}

/**
 * Clears this IP's cumulative failure count and any active block. Called on
 * a successful login — by product decision, proving you know a real
 * password wipes this IP's slate clean, even though on a shared IP (office
 * NAT, VPN exit) that could also erase an unrelated attacker's progress.
 */
export async function clearIpFailures(ip: string): Promise<void> {
  await Promise.all([redis.del(counterKey(ip)), redis.del(blockKey(ip))]);
}