/** Collision-avoiding label placement for SVG charts. */

export interface LabelCandidate {
  x: number;
  y: number;
  /** Radius of the mark the label belongs to. */
  r: number;
  text: string;
}

export interface PlacedLabel {
  index: number;
  x: number;
  y: number;
  anchor: "start" | "end" | "middle";
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Greedy label placement: each label, in the order given, takes the first
 * position around its mark that clears every mark, earlier label and the
 * bounds. Labels that fit nowhere are left out (the tooltip still has them).
 */
export function placeLabels(
  marks: readonly LabelCandidate[],
  bounds: Box,
  options: { charWidth?: number; height?: number; order?: number[]; obstacles?: Box[] } = {},
): PlacedLabel[] {
  const charWidth = options.charWidth ?? 6;
  const height = options.height ?? 13;
  const order = options.order ?? marks.map((_, i) => i);
  const taken: Box[] = [...(options.obstacles ?? [])];
  const placed: PlacedLabel[] = [];
  const hitsMark = (box: Box) =>
    marks.some((m) => {
      const nx = Math.max(box.x, Math.min(m.x, box.x + box.w));
      const ny = Math.max(box.y, Math.min(m.y, box.y + box.h));
      return (nx - m.x) ** 2 + (ny - m.y) ** 2 < (m.r + 1.5) ** 2;
    });
  const inside = (box: Box) =>
    box.x >= bounds.x &&
    box.y >= bounds.y &&
    box.x + box.w <= bounds.x + bounds.w &&
    box.y + box.h <= bounds.y + bounds.h;

  for (const index of order) {
    const m = marks[index];
    const w = m.text.length * charWidth + 4;
    const gap = m.r + 4;
    const candidates: [number, number, PlacedLabel["anchor"]][] = [
      [m.x + gap, m.y - height / 2, "start"],
      [m.x - gap - w, m.y - height / 2, "end"],
      [m.x - w / 2, m.y - gap - height + 2, "middle"],
      [m.x - w / 2, m.y + gap - 2, "middle"],
      [m.x + gap - 2, m.y - m.r - height + 2, "start"],
      [m.x + gap - 2, m.y + m.r - 2, "start"],
      [m.x - gap + 2 - w, m.y - m.r - height + 2, "end"],
      [m.x - gap + 2 - w, m.y + m.r - 2, "end"],
    ];
    for (const [x, y, anchor] of candidates) {
      const box = { x, y, w, h: height };
      if (!inside(box) || hitsMark(box) || taken.some((t) => intersects(t, box))) continue;
      taken.push(box);
      const textX = anchor === "start" ? x + 2 : anchor === "end" ? x + w - 2 : x + w / 2;
      placed.push({ index, x: textX, y: y + height - 3, anchor });
      break;
    }
  }
  return placed;
}

/** Push sorted label positions apart so neighbours are at least `gap` apart. */
export function spreadLabels(positions: readonly number[], gap: number, min = -Infinity): number[] {
  const order = positions.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const out = new Array<number>(positions.length);
  let last = min - gap;
  for (const { y, i } of order) {
    const next = Math.max(y, last + gap);
    out[i] = next;
    last = next;
  }
  return out;
}
