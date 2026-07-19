const DEFAULT_INTERVAL_MS = 60_000;

export interface ActiveTimeScaleOptions {
  /** Indexes whose preceding interval crosses a known shutdown/resume boundary. */
  breakBeforeIndexes?: ReadonlySet<number>;
}

function parseTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Builds a balanced active-time coordinate series. Ordinary intervals retain
 * their duration, while known session breaks and extreme unmarked outliers are
 * expressed as small multiples of the session's typical active interval.
 */
export function buildActiveTimeCoordinates(
  timestamps: Array<string | null | undefined>,
  options: ActiveTimeScaleOptions = {},
): number[] {
  if (!timestamps.length) return [];

  const parsed = timestamps.map(parseTimestamp);
  const allPositiveDeltas: number[] = [];
  const activeDeltas: number[] = [];
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    if (previous != null && current != null && current > previous) {
      const delta = current - previous;
      allPositiveDeltas.push(delta);
      if (!options.breakBeforeIndexes?.has(index)) activeDeltas.push(delta);
    }
  }

  const typicalCandidates = activeDeltas.length ? activeDeltas : allPositiveDeltas;
  typicalCandidates.sort((left, right) => left - right);
  const typical =
    typicalCandidates.length > 0
      ? typicalCandidates[Math.floor((typicalCandidates.length - 1) / 2)]
      : DEFAULT_INTERVAL_MS;

  const coordinates = [0];
  for (let index = 1; index < parsed.length; index += 1) {
    const previous = parsed[index - 1];
    const current = parsed[index];
    let visualDelta =
      previous != null && current != null && current >= previous ? current - previous : typical;

    if (options.breakBeforeIndexes?.has(index) && visualDelta > typical * 3) {
      visualDelta = typical * 3;
    } else if (visualDelta > typical * 8) {
      visualDelta = typical * 4;
    }

    coordinates.push(coordinates[index - 1] + visualDelta);
  }
  return coordinates;
}
