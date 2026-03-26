import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDateMedium,
  formatDateShort,
  formatNumberFull,
  formatPercent,
  formatRate,
  formatRelativeTime,
  toErrorMessage,
  formatNumber,
  formatDuration,
  formatCost,
  formatBytes,
} from '@tracepilot/types';

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

  // Cherry-picked edge-case tests from PR #124
  it('extracts message from Error subclasses (TypeError, RangeError)', () => {
    expect(toErrorMessage(new TypeError('Type mismatch'))).toBe('Type mismatch');
    expect(toErrorMessage(new RangeError('Index out of bounds'))).toBe('Index out of bounds');
  });

  it('ignores non-string message properties', () => {
    expect(toErrorMessage({ message: 42 })).toBe('[object Object]');
    expect(toErrorMessage({ message: true })).toBe('[object Object]');
    expect(toErrorMessage({ message: null })).toBe('[object Object]');
  });

  it('handles objects without message property', () => {
    expect(toErrorMessage({ code: 500, status: 'error' })).toBe('[object Object]');
  });

  it('stringifies additional number edge cases', () => {
    expect(toErrorMessage(0)).toBe('0');
    expect(toErrorMessage(-1)).toBe('-1');
    expect(toErrorMessage(3.14)).toBe('3.14');
  });

  it('handles arrays', () => {
    expect(toErrorMessage([1, 2, 3])).toBe('1,2,3');
    expect(toErrorMessage([])).toBe('Unknown error');
  });

  it('handles nested Error objects (extracts outer message only)', () => {
    const outerError = new Error('Outer error');
    (outerError as any).cause = new Error('Inner error');
    expect(toErrorMessage(outerError)).toBe('Outer error');
  });

  it('preserves multi-line error messages', () => {
    expect(toErrorMessage(new Error('Line 1\nLine 2\nLine 3'))).toBe('Line 1\nLine 2\nLine 3');
  });

  it('handles error-like objects with non-enumerable message', () => {
    const errorLike = Object.create(null);
    Object.defineProperty(errorLike, 'message', {
      value: 'Hidden message',
      enumerable: false,
    });
    expect(toErrorMessage(errorLike)).toBe('Hidden message');
  });
});

describe('formatNumber', () => {
  it('formats large numbers with M suffix', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M');
    expect(formatNumber(1_234_567)).toBe('1.2M');
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(9_999_999)).toBe('10.0M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1_000)).toBe('1.0K');
    expect(formatNumber(1_234)).toBe('1.2K');
    expect(formatNumber(12_345)).toBe('12.3K');
    expect(formatNumber(999_999)).toBe('1000.0K');
  });

  it('formats numbers under 1000 without suffix', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('handles null and undefined', () => {
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
  });

  it('handles fractional values', () => {
    expect(formatNumber(0.5)).toBe('0.5');
    expect(formatNumber(1_234.5)).toBe('1.2K');
  });
});

describe('formatDuration', () => {
  it('formats milliseconds', () => {
    expect(formatDuration(0)).toBe('0ms'); // 0 returns '0ms', not ''
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(999.99)).toBe('999.99ms'); // Rounds to 2 decimals
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(2100)).toBe('2.1s');
    expect(formatDuration(59_000)).toBe('59s');
    expect(formatDuration(59_999)).toBe('60.0s'); // Formats with decimal
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(125_000)).toBe('2m 5s');
    expect(formatDuration(3_599_000)).toBe('59m 59s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3_600_000)).toBe('1h 0m');
    expect(formatDuration(7_200_000)).toBe('2h 0m');
    expect(formatDuration(5_400_000)).toBe('1h 30m');
  });

  it('handles null and undefined', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
  });

  it('handles negative numbers', () => {
    expect(formatDuration(-1)).toBe('');
    expect(formatDuration(-1000)).toBe('');
  });
});

describe('formatCost', () => {
  it('formats zero as $0.00', () => {
    expect(formatCost(0)).toBe('$0.00');
  });

  it('formats small costs with two decimal places', () => {
    expect(formatCost(0.01)).toBe('$0.01');
    expect(formatCost(1.23)).toBe('$1.23');
    expect(formatCost(9.99)).toBe('$9.99');
  });

  it('formats large costs with comma separators', () => {
    expect(formatCost(1_000)).toBe('$1,000.00');
    expect(formatCost(1_234.56)).toBe('$1,234.56');
    expect(formatCost(1_000_000)).toBe('$1,000,000.00');
  });

  it('handles null and undefined', () => {
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
  });

  it('rounds to two decimal places', () => {
    expect(formatCost(0.999)).toBe('$1.00');
    expect(formatCost(1.234)).toBe('$1.23');
  });
});

describe('formatBytes', () => {
  it('handles zero and negative values', () => {
    expect(formatBytes(0)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('formats bytes', () => {
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1_048_576)).toBe('1.0 MB');
    expect(formatBytes(1_572_864)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1_073_741_824)).toBe('1.0 GB');
  });

  it('formats terabytes', () => {
    expect(formatBytes(1_099_511_627_776)).toBe('1.0 TB');
  });
});
