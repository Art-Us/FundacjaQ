import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  getSeverityBadgeInfo,
  SEVERITY_BADGE_INFO,
  isCategoryValidForKind,
  categoriesForKind,
  hexToRgba,
} from './alertLabels';

describe('formatDuration', () => {
  it('returns "0 min" for a zero or negative duration', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(-1)).toBe('0 min');
    expect(formatDuration(-60000)).toBe('0 min');
  });

  it('formats sub-hour durations as "N min"', () => {
    expect(formatDuration(60000)).toBe('1 min');
    expect(formatDuration(59 * 60000)).toBe('59 min');
  });

  it('formats sub-day durations as "Nh Nmin"', () => {
    expect(formatDuration(60 * 60000)).toBe('1h 0min');
    expect(formatDuration(90 * 60000)).toBe('1h 30min');
    expect(formatDuration(23 * 60 * 60000 + 45 * 60000)).toBe('23h 45min');
  });

  it('formats multi-day durations as "Nd Nh"', () => {
    expect(formatDuration(24 * 60 * 60000)).toBe('1d 0h');
    expect(formatDuration(25 * 60 * 60000)).toBe('1d 1h');
    expect(formatDuration(2 * 24 * 60 * 60000 + 5 * 60 * 60000 + 30 * 60000)).toBe('2d 5h');
  });
});

describe('getSeverityBadgeInfo', () => {
  it('returns the matching badge info for a known severity', () => {
    expect(getSeverityBadgeInfo('CRITICAL')).toEqual(SEVERITY_BADGE_INFO.CRITICAL);
    expect(getSeverityBadgeInfo('HIGH')).toEqual(SEVERITY_BADGE_INFO.HIGH);
    expect(getSeverityBadgeInfo('MEDIUM')).toEqual(SEVERITY_BADGE_INFO.MEDIUM);
    expect(getSeverityBadgeInfo('LOW')).toEqual(SEVERITY_BADGE_INFO.LOW);
  });

  it('falls back to LOW for an unrecognized severity value', () => {
    expect(getSeverityBadgeInfo('NOT_A_REAL_SEVERITY')).toEqual(SEVERITY_BADGE_INFO.LOW);
  });

  it('falls back to LOW for an empty severity value', () => {
    expect(getSeverityBadgeInfo('')).toEqual(SEVERITY_BADGE_INFO.LOW);
  });
});

describe('categoriesForKind', () => {
  it('returns the ALERT category list for kind ALERT', () => {
    expect(categoriesForKind('ALERT')).toEqual([
      'HYDROLOGICAL',
      'ROAD',
      'HUMANITARIAN',
      'FIRE',
      'INFRASTRUCTURE',
      'GENERAL',
    ]);
  });

  it('returns the EVENT category list for kind EVENT', () => {
    expect(categoriesForKind('EVENT')).toEqual([
      'FESTIVAL',
      'CONCERT',
      'SPORT',
      'COMMUNITY',
      'FAIR',
      'CULTURE',
      'OTHER_EVENT',
    ]);
  });
});

describe('isCategoryValidForKind', () => {
  it('is true for a category that belongs to the given ALERT kind', () => {
    expect(isCategoryValidForKind('FIRE', 'ALERT')).toBe(true);
    expect(isCategoryValidForKind('GENERAL', 'ALERT')).toBe(true);
  });

  it('is true for a category that belongs to the given EVENT kind', () => {
    expect(isCategoryValidForKind('CONCERT', 'EVENT')).toBe(true);
    expect(isCategoryValidForKind('OTHER_EVENT', 'EVENT')).toBe(true);
  });

  it('is false for a category that belongs to the other kind (mismatched pair)', () => {
    expect(isCategoryValidForKind('FIRE', 'EVENT')).toBe(false);
    expect(isCategoryValidForKind('CONCERT', 'ALERT')).toBe(false);
  });

  it('is false for an unknown category value', () => {
    expect(isCategoryValidForKind('NOT_A_CATEGORY', 'ALERT')).toBe(false);
    expect(isCategoryValidForKind('NOT_A_CATEGORY', 'EVENT')).toBe(false);
  });
});

describe('hexToRgba', () => {
  it('converts a known 6-digit hex color to rgba with the given alpha', () => {
    expect(hexToRgba('#f43f5e', 0.5)).toBe('rgba(244, 63, 94, 0.5)');
    expect(hexToRgba('#22c55e', 1)).toBe('rgba(34, 197, 94, 1)');
  });

  it('handles a hex value without the leading #', () => {
    expect(hexToRgba('f43f5e', 0.5)).toBe('rgba(244, 63, 94, 0.5)');
  });

  it('produces rgba(0, 0, 0, alpha) for black', () => {
    expect(hexToRgba('#000000', 0.2)).toBe('rgba(0, 0, 0, 0.2)');
  });

  it('produces rgba(255, 255, 255, alpha) for white', () => {
    expect(hexToRgba('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });
});
