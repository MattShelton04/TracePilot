import { describe, expect, it } from 'vitest';
import {
  formatDateMedium,
  formatDateShort,
  formatNumberFull,
  formatPercent,
  formatRate,
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
