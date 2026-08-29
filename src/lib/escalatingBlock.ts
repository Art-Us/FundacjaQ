// Shared tier math for every escalating block in the app (currently: the
// IP-wide login block and the email+IP pair login block). Every 5th
// cumulative failure re-triggers a block, escalating 1min -> 5min -> 15min
// -> 30min; past the last tier, every further multiple of 5 repeats 30min.
const ATTEMPTS_PER_TIER = 5;
const TIER_BLOCK_SECONDS = [60, 5 * 60, 15 * 60, 30 * 60];

/** Returns the block duration (seconds) to (re)apply at this cumulative count, or null if this count doesn't cross a tier boundary. */
export function blockSecondsForCount(count: number): number | null {
  if (count === 0 || count % ATTEMPTS_PER_TIER !== 0) return null;
  const tierIndex = count / ATTEMPTS_PER_TIER - 1;
  return TIER_BLOCK_SECONDS[Math.min(tierIndex, TIER_BLOCK_SECONDS.length - 1)];
}