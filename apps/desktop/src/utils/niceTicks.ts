/**
 * "Nice" linear-axis ticks for SVG charts.
 *
 * Picks a round step (1, 2, 2.5 or 5 × 10ⁿ) close to `max / targetSegments`,
 * then extends the axis maximum to the next whole step. Scale marks against
 * the returned `max` so every gridline label matches the data it crosses.
 */

export interface NiceTicks {
  /** Axis maximum: the top tick. Always ≥ the input maximum. */
  max: number;
  /** Distance between ticks. */
  step: number;
  /** Tick values from 0 to `max` inclusive. */
  ticks: number[];
}

export interface NiceTicksOptions {
  /** Preferred number of intervals between 0 and the maximum (default 4). */
  targetSegments?: number;
  /** Upper bound on intervals; a larger step is used beyond it (default 6). */
  maxSegments?: number;
  /** Restrict steps to whole numbers, e.g. for counts (default false). */
  integer?: boolean;
}

const MANTISSAS = [1, 2, 2.5, 5] as const;

function candidateSteps(raw: number, integer: boolean): number[] {
  const exponent = Math.floor(Math.log10(raw));
  const steps: number[] = [];
  for (let e = exponent - 1; e <= exponent + 1; e += 1) {
    const magnitude = 10 ** e;
    for (const mantissa of MANTISSAS) {
      // Round away floating-point noise such as 0.30000000000000004.
      const step = Number((mantissa * magnitude).toPrecision(2));
      if (integer && !Number.isInteger(step)) continue;
      steps.push(step);
    }
  }
  if (integer && !steps.includes(1)) steps.unshift(1);
  return steps.sort((a, b) => a - b);
}

/** Decimal places that represent every multiple of a 1/2/2.5/5 × 10ⁿ step exactly. */
function decimalsOf(step: number): number {
  return Math.min(20, Math.max(0, Math.ceil(-Math.log10(step)) + 1));
}

/**
 * Compute evenly spaced, round tick values for an axis starting at 0.
 *
 * Non-positive or non-finite maxima are treated as 1.
 */
export function niceTicks(maxValue: number, options: NiceTicksOptions = {}): NiceTicks {
  const { targetSegments = 4, maxSegments = 6, integer = false } = options;
  const max = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const raw = max / Math.max(1, targetSegments);
  const steps = candidateSteps(raw, integer);

  // Nearest candidate on a log scale, then widen until the segment cap holds.
  let index = 0;
  let best = Number.POSITIVE_INFINITY;
  steps.forEach((step, i) => {
    const distance = Math.abs(Math.log(step / raw));
    if (distance < best) {
      best = distance;
      index = i;
    }
  });
  while (index < steps.length - 1 && Math.ceil(max / steps[index] - 1e-9) > maxSegments) {
    index += 1;
  }

  const step = steps[index];
  const segments = Math.max(1, Math.ceil(max / step - 1e-9));
  const decimals = decimalsOf(step);
  const ticks = Array.from({ length: segments + 1 }, (_, i) =>
    Number((i * step).toFixed(decimals)),
  );
  return { max: ticks[segments], step, ticks };
}
