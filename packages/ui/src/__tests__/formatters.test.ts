import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDateMedium,
  formatDateShort,
  formatNumberFull,
  formatPercent,
  formatRate,
  formatRelativeTime,
  toErrorMessage,
} from '../utils/formatters';

describe('formatRate', () => {
  it('formats 0-1 rate as percentage', () => {
    expect(formatRate(0.95)).toBe('95.0%');
    expect(formatRate(0)).toBe('0.0%');
    expect(formatRate(1)).toBe('100.0%');
  });
  it('handles null/undefined', () => {
    expect(formatRate(null)).toBe('0.0%');
    expect(formatRate(undefined)).toBe('0.0%');
  });
});

describe('formatPercent', () => {
  it('formats 0-100 value as percentage string', () => {
    expect(formatPercent(95.1)).toBe('95.1%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(100)).toBe('100.0%');
  });
  it('handles null/undefined', () => {
    expect(formatPercent(null)).toBe('0.0%');
    expect(formatPercent(undefined)).toBe('0.0%');
  });
});

describe('formatDateShort', () => {
  it('formats ISO date as M/D', () => {
    expect(formatDateShort('2026-03-19T00:00:00Z')).toBe('3/19');
    expect(formatDateShort('2026-12-01T00:00:00Z')).toBe('12/1');
  });
  it('handles null/empty', () => {
    expect(formatDateShort(null)).toBe('');
    expect(formatDateShort('')).toBe('');
  });
});

describe('formatDateMedium', () => {
  it('formats ISO date as medium string', () => {
    const result = formatDateMedium('2026-03-19T00:00:00Z');
    expect(result).toContain('Mar');
    expect(result).toContain('19');
    expect(result).toContain('2026');
  });
  it('handles null/empty', () => {
    expect(formatDateMedium(null)).toBe('');
    expect(formatDateMedium('')).toBe('');
  });
  it('formats Unix timestamp (seconds) as medium date string', () => {
    // 2026-03-19T00:00:00Z = 1773878400 seconds
    const result = formatDateMedium(1773878400);
    expect(result).toContain('Mar');
    expect(result).toContain('19');
    expect(result).toContain('2026');
  });
  it('returns empty for invalid number inputs', () => {
    expect(formatDateMedium(NaN)).toBe('');
    expect(formatDateMedium(Infinity)).toBe('');
    expect(formatDateMedium(-Infinity)).toBe('');
  });
  it('handles Unix epoch (0)', () => {
    const result = formatDateMedium(0);
    expect(result).toContain('1970');
  });
});

describe('formatNumberFull', () => {
  it('formats with locale separators', () => {
    expect(formatNumberFull(1234)).toBe('1,234');
    expect(formatNumberFull(0)).toBe('0');
  });
  it('handles null/undefined', () => {
    expect(formatNumberFull(null)).toBe('0');
    expect(formatNumberFull(undefined)).toBe('0');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fix "now" to 2026-03-23T12:00:00Z
    vi.setSystemTime(new Date('2026-03-23T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty for null/undefined/empty string', () => {
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
    expect(formatRelativeTime('')).toBe('');
  });

  it('returns "just now" for recent ISO dates', () => {
    expect(formatRelativeTime('2026-03-23T11:59:30Z')).toBe('just now');
  });

  it('returns minutes for ISO dates within the hour', () => {
    expect(formatRelativeTime('2026-03-23T11:55:00Z')).toBe('5m ago');
  });

  it('returns hours for ISO dates within the day', () => {
    expect(formatRelativeTime('2026-03-23T09:00:00Z')).toBe('3h ago');
  });

  it('returns days for ISO dates within the week', () => {
    expect(formatRelativeTime('2026-03-20T12:00:00Z')).toBe('3d ago');
  });

  it('returns weeks for ISO dates within the month', () => {
    expect(formatRelativeTime('2026-03-09T12:00:00Z')).toBe('2w ago');
  });

  it('returns months for ISO dates beyond 30 days', () => {
    expect(formatRelativeTime('2026-01-23T12:00:00Z')).toBe('1mo ago');
  });

  // ── Unix timestamp (seconds) support ──

  it('returns "just now" for recent Unix timestamps', () => {
    const thirtySecsAgo = Math.floor(new Date('2026-03-23T11:59:30Z').getTime() / 1000);
    expect(formatRelativeTime(thirtySecsAgo)).toBe('just now');
  });

  it('returns minutes for Unix timestamps within the hour', () => {
    const fiveMinAgo = Math.floor(new Date('2026-03-23T11:55:00Z').getTime() / 1000);
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours for Unix timestamps within the day', () => {
    const threeHrsAgo = Math.floor(new Date('2026-03-23T09:00:00Z').getTime() / 1000);
    expect(formatRelativeTime(threeHrsAgo)).toBe('3h ago');
  });

  it('returns weeks for Unix timestamps within the month', () => {
    const twoWeeksAgo = Math.floor(new Date('2026-03-09T12:00:00Z').getTime() / 1000);
    expect(formatRelativeTime(twoWeeksAgo)).toBe('2w ago');
  });

  it('returns months for Unix timestamps beyond 30 days', () => {
    const twoMonthsAgo = Math.floor(new Date('2026-01-23T12:00:00Z').getTime() / 1000);
    expect(formatRelativeTime(twoMonthsAgo)).toBe('1mo ago');
  });

  // ── Edge cases ──

  it('returns empty for NaN/Infinity number inputs', () => {
    expect(formatRelativeTime(NaN)).toBe('');
    expect(formatRelativeTime(Infinity)).toBe('');
    expect(formatRelativeTime(-Infinity)).toBe('');
  });

  it('handles Unix epoch (0) as a very old date', () => {
    const result = formatRelativeTime(0);
    expect(result).toMatch(/\d+mo ago/);
  });

  it('returns empty for invalid ISO strings', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });

  it('returns "just now" for future timestamps', () => {
    expect(formatRelativeTime('2026-03-24T12:00:00Z')).toBe('just now');
    const futureUnix = Math.floor(new Date('2026-03-24T12:00:00Z').getTime() / 1000);
    expect(formatRelativeTime(futureUnix)).toBe('just now');
  });

  it('returns days for Unix timestamps within the week', () => {
    const threeDaysAgo = Math.floor(new Date('2026-03-20T12:00:00Z').getTime() / 1000);
    expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
  });
});

describe('toErrorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom');
    expect(toErrorMessage(new TypeError('type issue'))).toBe('type issue');
    expect(toErrorMessage(new RangeError('out of range'))).toBe('out of range');
  });

  it('returns empty string for Error with empty message', () => {
    expect(toErrorMessage(new Error())).toBe('');
    expect(toErrorMessage(new Error(''))).toBe('');
  });

  it('returns string values directly', () => {
    expect(toErrorMessage('already a string')).toBe('already a string');
    expect(toErrorMessage('')).toBe('');
  });

  it('converts other values via String()', () => {
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
    expect(toErrorMessage(true)).toBe('true');
  });

  it('uses fallback for non-Error, non-string values when provided', () => {
    expect(toErrorMessage(42, 'Something went wrong')).toBe('Something went wrong');
    expect(toErrorMessage(null, 'Unknown error')).toBe('Unknown error');
    expect(toErrorMessage(undefined, 'Oops')).toBe('Oops');
  });

  it('ignores fallback for Error instances', () => {
    expect(toErrorMessage(new Error('real error'), 'fallback')).toBe('real error');
  });

  it('ignores fallback for string values', () => {
    expect(toErrorMessage('string error', 'fallback')).toBe('string error');
  });

  it('handles plain objects via String()', () => {
    expect(toErrorMessage({})).toBe('[object Object]');
    expect(toErrorMessage({}, 'Unexpected error')).toBe('Unexpected error');
  });
});
