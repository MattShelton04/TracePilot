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
  it('extracts message from Error objects', () => {
    expect(toErrorMessage(new Error('oops'))).toBe('oops');
  });

  it('returns Error.message even when empty (no fallback override)', () => {
    expect(toErrorMessage(new Error(''))).toBe('');
  });

  it('stringifies non-Error values', () => {
    expect(toErrorMessage('string error')).toBe('string error');
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(false)).toBe('false');
  });

  it('returns fallback for null and undefined', () => {
    expect(toErrorMessage(null)).toBe('Unknown error');
    expect(toErrorMessage(undefined)).toBe('Unknown error');
  });

  it('returns fallback for empty string', () => {
    expect(toErrorMessage('')).toBe('Unknown error');
  });

  it('uses custom fallback when provided', () => {
    expect(toErrorMessage(null, 'Custom fallback')).toBe('Custom fallback');
    expect(toErrorMessage(undefined, 'Custom fallback')).toBe('Custom fallback');
    expect(toErrorMessage('', 'Custom fallback')).toBe('Custom fallback');
  });

  it('ignores fallback when non-Error value stringifies to non-empty', () => {
    expect(toErrorMessage('actual error', 'Custom fallback')).toBe('actual error');
    expect(toErrorMessage(404, 'Not found')).toBe('404');
  });

  it('extracts message from error-like objects with message property', () => {
    expect(toErrorMessage({ message: 'serialized error' })).toBe('serialized error');
    expect(toErrorMessage({ message: '' })).toBe('Unknown error');
    expect(toErrorMessage({ message: 'fail', code: 42 })).toBe('fail');
  });
});
