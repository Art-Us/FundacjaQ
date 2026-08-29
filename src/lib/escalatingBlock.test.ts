import { describe, it, expect } from 'vitest';
import { blockSecondsForCount } from './escalatingBlock';

describe('blockSecondsForCount', () => {
  it('does not trigger a block below the first tier', () => {
    expect(blockSecondsForCount(0)).toBeNull();
    expect(blockSecondsForCount(4)).toBeNull();
  });

  it('does not trigger a block for counts that are not a multiple of 5', () => {
    expect(blockSecondsForCount(6)).toBeNull();
    expect(blockSecondsForCount(11)).toBeNull();
  });

  it('escalates 1min -> 5min -> 15min -> 30min at each multiple of 5', () => {
    expect(blockSecondsForCount(5)).toBe(60);
    expect(blockSecondsForCount(10)).toBe(5 * 60);
    expect(blockSecondsForCount(15)).toBe(15 * 60);
    expect(blockSecondsForCount(20)).toBe(30 * 60);
  });

  it('keeps repeating 30min for every further multiple of 5 past the last tier', () => {
    expect(blockSecondsForCount(25)).toBe(30 * 60);
    expect(blockSecondsForCount(30)).toBe(30 * 60);
    expect(blockSecondsForCount(100)).toBe(30 * 60);
  });
});