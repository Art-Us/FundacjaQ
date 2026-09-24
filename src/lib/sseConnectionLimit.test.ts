import { describe, it, expect, vi, afterEach } from 'vitest';
import { acquireSseSlot, releaseSseSlot, touchSseSlot } from './sseConnectionLimit';

afterEach(() => {
  vi.useRealTimers();
});

describe('acquireSseSlot / releaseSseSlot / touchSseSlot', () => {
  it('allows a fresh user up to the cap, then refuses the next one', () => {
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(acquireSseSlot(userId)).not.toBeNull();
    }
    expect(acquireSseSlot(userId)).toBeNull();
  });

  it('frees a slot on release, letting a new connection take its place', () => {
    const userId = `user-${Math.random()}`;
    let lastSlot: string | null = null;
    for (let i = 0; i < 20; i++) lastSlot = acquireSseSlot(userId);
    expect(acquireSseSlot(userId)).toBeNull();

    releaseSseSlot(lastSlot!);
    expect(acquireSseSlot(userId)).not.toBeNull();
  });

  it('tracks each user independently — one user hitting the cap never blocks another', () => {
    const userA = `user-a-${Math.random()}`;
    const userB = `user-b-${Math.random()}`;
    for (let i = 0; i < 20; i++) acquireSseSlot(userA);
    expect(acquireSseSlot(userA)).toBeNull();
    expect(acquireSseSlot(userB)).not.toBeNull();
  });

  it('releasing the same slot twice, or a slot that never existed, is a harmless no-op', () => {
    const userId = `user-${Math.random()}`;
    const slotId = acquireSseSlot(userId);
    releaseSseSlot(slotId!);
    expect(() => releaseSseSlot(slotId!)).not.toThrow();
    expect(() => releaseSseSlot('never-existed')).not.toThrow();
  });

  it('sweeps a slot that was never touched past its TTL, freeing it up for a new connection', () => {
    vi.useFakeTimers();
    const userId = `user-${Math.random()}`;
    for (let i = 0; i < 20; i++) acquireSseSlot(userId);
    expect(acquireSseSlot(userId)).toBeNull();

    // None of those 20 slots ever got a heartbeat touchSseSlot() call — the
    // exact "cancel() never ran" leak this safety net exists for.
    vi.advanceTimersByTime(71_000);
    expect(acquireSseSlot(userId)).not.toBeNull();
  });

  it('a slot kept alive via touchSseSlot survives past the TTL of an untouched one', () => {
    vi.useFakeTimers();
    const userId = `user-${Math.random()}`;
    const keptAlive = acquireSseSlot(userId)!;
    for (let i = 0; i < 19; i++) acquireSseSlot(userId);
    expect(acquireSseSlot(userId)).toBeNull();

    // Two heartbeat-length ticks, touching only the one slot each time —
    // it should never go stale, while the other 19 eventually do.
    vi.advanceTimersByTime(40_000);
    touchSseSlot(keptAlive);
    vi.advanceTimersByTime(40_000);
    touchSseSlot(keptAlive);

    // The untouched 19 are well past SLOT_TTL_MS by now; a fresh acquire
    // sweeps them and succeeds, without evicting the one kept alive.
    expect(acquireSseSlot(userId)).not.toBeNull();
    releaseSseSlot(keptAlive);
  });
});
