import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import { redis } from './redis';

// Login attempts are throttled by ipLockout.ts (IP-wide) and
// loginPairLockout.ts (email+IP pair) instead of a flat limiter here — both
// escalate the block duration instead of repeating a fixed one.

export const inviteAcceptLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:invite-accept',
  points: 100, // TEMP: was 10 — revert after [reason/date]
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

export const passwordResetLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:pwd-reset',
  points: 100, // TEMP: was 5 — revert after [reason/date]
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
  points: 100, // TEMP: was 20 — revert after [reason/date]
  duration: 60 * 60,
  blockDuration: 60 * 60,
});

// Nominatim's usage policy caps free reverse-geocoding lookups at ~1
// request/second per app — this backstops the client-side debounce in case
// of a scripted/compromised client, so our server IP doesn't get rate-limited
// or blocked by Nominatim for the whole app.
//
// This limiter is keyed per user, but Nominatim's ~1 req/s cap applies to
// the app as a whole. It's fine at pilot scale (a handful of concurrent
// ADMIN/COORDINATOR users), but doesn't actually enforce the app-wide limit
// once there are multiple concurrent users geocoding — each user gets their
// own 1 req/s budget. If usage grows, switch to a shared key (e.g. a fixed
// string instead of the user id) or self-host a Nominatim instance to drop
// the external cap entirely.
export const geocodeLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:geocode',
  points: 1,
  duration: 1,
  blockDuration: 3,
});

/**
 * Returns true if the action is allowed; false if rate-limited. Consumes on
 * every call.
 *
 * Fails open (like attemptTracker.ts/ipLockout.ts/lockout.ts elsewhere in
 * this codebase) on an actual Redis/store error — rate-limiter-flexible
 * rejects consume() with a RateLimiterRes when points are exhausted, but
 * with a plain Error when the store itself failed (see its own d.ts: "only
 * for store and database limiters ... rejRes is Error object"). Treating
 * both the same as "rate limited" would turn a Redis blip into a blanket 429
 * across login/password-reset/invite-accept for every user, which is a
 * worse outage than the abuse this is meant to catch.
 */
export async function consumeLimit(limiter: RateLimiterRedis, key: string): Promise<boolean> {
  try {
    await limiter.consume(key);
    return true;
  } catch (err) {
    if (err instanceof RateLimiterRes) return false;
    console.error('[rateLimit] consume failed (store error), failing open:', err);
    return true;
  }
}
