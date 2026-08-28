import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from './redis';

// keyed by `${email}:${ip}` at call sites so one bad actor can't lock out
// everyone sharing an IP, and a single email can't be hammered from many IPs.
export const loginLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:login',
  points: 5,
  duration: 15 * 60, // 5 attempts / 15 min
  blockDuration: 15 * 60,
});

export const inviteAcceptLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:invite-accept',
  points: 10,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

export const passwordResetLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:pwd-reset',
  points: 5,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

// Keyed by email alone (no IP) so an attacker can't bypass the per-IP limit
// above by rotating IPs and flood a victim's inbox with reset emails.
export const passwordResetPerAccountLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:pwd-reset-acct',
  points: 10,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

export const inviteCreateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:invite-create',
  points: 20,
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

/** Returns true if the action is allowed; false if rate-limited. Consumes on every call. */
export async function consumeLimit(limiter: RateLimiterRedis, key: string): Promise<boolean> {
  try {
    await limiter.consume(key);
    return true;
  } catch {
    return false;
  }
}
