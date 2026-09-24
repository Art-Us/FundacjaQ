// Caps how many concurrent SSE connections one signed-in user can hold open
// across BOTH live-refresh routes (api/events, api/admin/events) — they
// share this one counter (keyed by userId alone, not per-route) because what
// they actually compete for is the same shared resource: a socket held open
// indefinitely, its own heartbeat setInterval, and an entry in
// lib/adminEvents.ts's process-wide `listeners` Set.
//
// Without this, ANY authenticated user — including the lowest-privileged
// VOLUNTEER, no special access needed — can open an unbounded number of
// EventSource connections (trivially, from the browser console) and exhaust
// server sockets/memory: a denial of service against every other user, not
// just the one doing it. requireUser()/requireAdminOrCoordinator() alone
// don't prevent this — they only check WHO you are, not HOW MANY of you are
// connected.
//
// In-memory per-process, matching lib/adminEvents.ts's own `listeners` Set
// (this app doesn't fan the SSE subscriber set out across instances either)
// — enough to stop one account from overwhelming whichever instance it lands
// on; a multi-instance deployment gets this cap multiplied by instance
// count, still far better than the unbounded status quo.

interface SlotRecord {
  userId: string;
  lastSeen: number;
}

const globalForSseLimit = globalThis as unknown as {
  sseSlots: Map<string, SlotRecord> | undefined;
};

const slots = globalForSseLimit.sseSlots ?? new Map<string, SlotRecord>();
if (process.env.NODE_ENV !== 'production') globalForSseLimit.sseSlots = slots;

// Generous enough that no real user ever hits it — AppEventsBridge (every
// user) plus AdminEventsBridge (ADMIN/COORDINATOR only) means at most 2 per
// open tab, so this covers a dozen simultaneous tabs/devices on one account
// — while still bounding how many extra sockets a scripted flood from a
// single account can accumulate.
const MAX_CONNECTIONS_PER_USER = 20;

// Both SSE routes' own heartbeat ticks every 25s (HEARTBEAT_MS there) and
// must call touchSseSlot() on every tick — this is the safety net for a slot
// whose owning connection never called releaseSseSlot(), because its
// `cancel()` never ran (an abrupt disconnect a proxy/OS didn't report, a
// crashed tab, a dead wifi link) — the exact same "cancel() isn't guaranteed
// to fire" gap lib/adminEvents.ts's `listeners` Set already lives with.
// Without this, those leaked slots would count against the cap forever,
// eventually locking a real user out of live-refresh despite only ever
// having a couple of tabs genuinely open. Comfortably above 2x the
// heartbeat interval so ordinary event-loop/network jitter between two
// ticks never mistakes a live connection for a dead one.
const SLOT_TTL_MS = 70_000;

let nextSlotSeq = 0;

function sweepExpired(now: number): void {
  slots.forEach((record, slotId) => {
    if (now - record.lastSeen > SLOT_TTL_MS) slots.delete(slotId);
  });
}

/**
 * Reserves one connection slot for `userId` if they're still under the cap
 * (expired slots — see SLOT_TTL_MS above — are swept first, so a leaked slot
 * never permanently counts against it). Returns the slot's id on success, or
 * null when the caller must refuse the connection (e.g. HTTP 429). Every
 * non-null result must eventually be released via releaseSseSlot, and kept
 * alive in the meantime via touchSseSlot on every heartbeat tick.
 */
export function acquireSseSlot(userId: string): string | null {
  const now = Date.now();
  sweepExpired(now);

  let current = 0;
  slots.forEach((record) => {
    if (record.userId === userId) current++;
  });
  if (current >= MAX_CONNECTIONS_PER_USER) return null;

  const slotId = `${userId}:${++nextSlotSeq}`;
  slots.set(slotId, { userId, lastSeen: now });
  return slotId;
}

/** Marks `slotId` as still alive — call on every heartbeat tick of the connection that acquired it, or it'll be swept as stale after SLOT_TTL_MS. */
export function touchSseSlot(slotId: string): void {
  const record = slots.get(slotId);
  if (record) record.lastSeen = Date.now();
}

/** Releases a slot reserved by acquireSseSlot. A no-op if it's already gone (released twice, or already swept as stale) — Map.delete on a missing key is safe. */
export function releaseSseSlot(slotId: string): void {
  slots.delete(slotId);
}
