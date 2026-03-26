import { describe, it, expect } from 'vitest';
import {
  formatSessionDelta,
  formatModelDelta,
  type FormattedDelta,
  type ModelDelta,
} from '../../utils/deltaFormatting';

// ── formatSessionDelta ──────────────────────────────────────────────────────

describe('formatSessionDelta', () => {
  it('returns neutral when both values are zero', () => {
    const result = formatSessionDelta(0, 0, true);
    expect(result).toEqual({ delta: '—', deltaClass: 'delta-neutral', arrow: '' });
  });

  it('returns neutral when difference is negligible', () => {
    const result = formatSessionDelta(100, 100.0005, true);
    expect(result).toEqual({ delta: '—', deltaClass: 'delta-neutral', arrow: '' });
  });

  it('shows percentage when change > 1%', () => {
    const result = formatSessionDelta(100, 120, true);
    expect(result.delta).toBe('↑ 20%');
    expect(result.deltaClass).toBe('delta-positive');
    expect(result.arrow).toBe('↑');
  });

  it('shows absolute difference when change ≤ 1%', () => {
    const result = formatSessionDelta(100, 100.5, true);
    expect(result.delta).toBe('↑ 0.5');
  });

  it('marks decrease as positive when higher is NOT better', () => {
    // e.g. cost: lower is better, so b < a is positive
    const result = formatSessionDelta(100, 80, false);
    expect(result.deltaClass).toBe('delta-positive');
    expect(result.arrow).toBe('↓');
  });

  it('marks increase as negative when higher is NOT better', () => {
    // e.g. cost: lower is better, so b > a is negative
    const result = formatSessionDelta(100, 150, false);
    expect(result.deltaClass).toBe('delta-negative');
    expect(result.arrow).toBe('↑');
  });

  it('handles a = 0, b > 0 (uses base = 1)', () => {
    const result = formatSessionDelta(0, 5, true);
    expect(result.arrow).toBe('↑');
    expect(result.deltaClass).toBe('delta-positive');
    // pct = |5| / max(0, 1) * 100 = 500%
    expect(result.delta).toBe('↑ 500%');
  });

  it('handles negative values', () => {
    const result = formatSessionDelta(-10, -5, true);
    // diff = -5 - (-10) = 5, base = max(10, 1) = 10, pct = 50%
    expect(result.delta).toBe('↑ 50%');
    expect(result.deltaClass).toBe('delta-positive');
  });

  it('returns typed result matching FormattedDelta interface', () => {
    const result: FormattedDelta = formatSessionDelta(10, 20, true);
    expect(typeof result.delta).toBe('string');
    expect(typeof result.deltaClass).toBe('string');
    expect(typeof result.arrow).toBe('string');
  });
});

// ── formatModelDelta ────────────────────────────────────────────────────────

describe('formatModelDelta', () => {
  it('returns neutral when difference is negligible', () => {
    const result = formatModelDelta(100, 100, true);
    expect(result).toEqual({ delta: '—', direction: 'neutral', better: 'neutral' });
  });

  it('shows positive percentage when a > b', () => {
    const result = formatModelDelta(120, 100, true);
    // diff = 20, pct = (20/100)*100 = 20.0
    expect(result.delta).toBe('+20.0%');
    expect(result.direction).toBe('up');
    expect(result.better).toBe('a');
  });

  it('shows negative percentage when a < b', () => {
    const result = formatModelDelta(80, 100, true);
    // diff = -20, pct = (-20/100)*100 = -20.0
    expect(result.delta).toBe('-20.0%');
    expect(result.direction).toBe('down');
    expect(result.better).toBe('b');
  });

  it('uses +∞ when a > 0 and b is zero', () => {
    const result = formatModelDelta(50, 0, true);
    expect(result.delta).toBe('+∞%');
    expect(result.direction).toBe('up');
    expect(result.better).toBe('a');
  });

  it('uses -∞ when a < 0 and b is zero', () => {
    const result = formatModelDelta(-5, 0, true);
    expect(result.delta).toBe('-∞%');
    expect(result.direction).toBe('down');
    expect(result.better).toBe('b');
  });

  it('marks lower cost as better when higherIsBetter is false', () => {
    const result = formatModelDelta(80, 100, false);
    // diff = -20, a is lower → a is better when lower is better
    expect(result.better).toBe('a');
    expect(result.direction).toBe('down');
  });

  it('marks higher cost as worse when higherIsBetter is false', () => {
    const result = formatModelDelta(120, 100, false);
    expect(result.better).toBe('b');
    expect(result.direction).toBe('up');
  });

  it('handles equal values as neutral', () => {
    const result = formatModelDelta(42, 42, false);
    expect(result.direction).toBe('neutral');
    expect(result.better).toBe('neutral');
    expect(result.delta).toBe('—');
  });

  it('returns typed result matching ModelDelta interface', () => {
    const result: ModelDelta = formatModelDelta(10, 20, true);
    expect(typeof result.delta).toBe('string');
    expect(['up', 'down', 'neutral']).toContain(result.direction);
    expect(['a', 'b', 'neutral']).toContain(result.better);
  });

  it('handles negative values', () => {
    const result = formatModelDelta(-5, -10, true);
    // diff = -5 - (-10) = 5, pct = (5/10)*100 = 50.0
    expect(result.delta).toBe('+50.0%');
    expect(result.direction).toBe('up');
    expect(result.better).toBe('a');
  });
});
