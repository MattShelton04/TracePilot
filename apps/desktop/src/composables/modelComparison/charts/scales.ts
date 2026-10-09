/** Linear and log scales and tick choices for the Models page charts. */

export type Scale = (value: number) => number;

/** Linear map from `domain` to `range`. */
export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * Base-10 log map from `domain` to `range`. The domain may run either way
 * (high-to-low flips the axis). Values at or below zero clamp to a tenth of
 * the domain's lower bound so they sit just outside it rather than at -∞.
 */
export function logScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  const floor = Math.min(d0, d1) / 10;
  const span = l1 - l0 || 1;
  return (value) => r0 + ((Math.log10(Math.max(value, floor)) - l0) / span) * (r1 - r0);
}

/** Powers of ten spanning `values`, at least `minDecades` apart. */
export function decadeDomain(values: readonly number[], minDecades = 2): [number, number] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [1, 10 ** minDecades];
  let lo = Math.floor(Math.log10(Math.min(...positive)));
  let hi = Math.ceil(Math.log10(Math.max(...positive)));
  while (hi - lo < minDecades) {
    hi += 1;
    if (hi - lo < minDecades) lo -= 1;
  }
  return [10 ** lo, 10 ** hi];
}

const NICE_LOG_STEPS = [1, 2, 5];

/**
 * A log domain that hugs the data: bounds snap outward to 1, 2 or 5 times a
 * power of ten instead of whole decades, so a series spanning 0.1–1.9 does
 * not waste two empty decades.
 */
export function niceLogDomain(values: readonly number[]): [number, number] {
  const positive = values.filter((v) => v > 0);
  if (positive.length === 0) return [1, 10];
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  const down = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    return (
      [...NICE_LOG_STEPS]
        .reverse()
        .map((k) => k * p)
        .find((s) => s <= v * (1 + 1e-9)) ?? p
    );
  };
  const up = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(v));
    return [...NICE_LOG_STEPS, 10].map((k) => k * p).find((s) => s >= v * (1 - 1e-9)) ?? 10 * p;
  };
  const lo = down(min);
  const hi = up(max);
  return hi > lo ? [lo, hi] : [lo, up(lo * 1.0001)];
}

/** Ticks for a log axis: 1-2-5 steps when they fit, else whole powers of ten. */
export function logTicks(domain: [number, number], maxTicks = 6): number[] {
  const lo = Math.min(...domain);
  const hi = Math.max(...domain);
  const within = (v: number) => v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9);
  const build = (steps: number[]) => {
    const out: number[] = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const k of steps) {
        const v = Number((k * 10 ** e).toPrecision(6));
        if (within(v)) out.push(v);
      }
    }
    return out;
  };
  for (const steps of [NICE_LOG_STEPS, [1, 3], [1]]) {
    const ticks = build(steps);
    if (ticks.length <= maxTicks) return ticks;
  }
  const powers = build([1]);
  const stride = Math.ceil(powers.length / maxTicks);
  return powers.filter((_, i) => i % stride === 0);
}

/** A "nice" upper bound and tick step for a linear axis starting at zero. */
export function niceLinearTicks(max: number, targetTicks = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const raw = max / targetTicks;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * power).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1e6; v += step) ticks.push(Number(v.toFixed(10)));
  return { max: top, ticks };
}
