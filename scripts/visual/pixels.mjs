// Runs on decoded PNGs in the trusted reporter, never on browser canvas readbacks.
export const thresholds = [0, 8, 16, 32];
// A triage category, never an assertion that pixels match or a regression is
// harmless. Keep the exact heatmap/count even for sparse low-contrast changes.
export function classifyPixels(analyses) {
  if (analyses[0].changed === 0) return "unchanged";
  return analyses[0].changed <= 128 && analyses[8].changed === 0 ? "subtle" : "changed";
}
export async function compare(before, after, width, height, options = {}) {
  if (
    width !== 1440 ||
    height !== 960 ||
    before.length !== width * height * 4 ||
    after.length !== before.length
  )
    throw new Error("Expected matching 1440×960 RGBA images");
  const threshold = Math.max(0, Math.min(255, Number(options.threshold) || 0));
  const heat = new Uint8ClampedArray(before.length);
  const tileSize = 8,
    columns = Math.ceil(width / tileSize),
    tiles = new Map();
  let changed = 0,
    minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      let delta = 0;
      for (let channel = 0; channel < 4; channel++)
        delta = Math.max(delta, Math.abs(before[offset + channel] - after[offset + channel]));
      if (delta <= threshold) continue;
      changed++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      heat.set([255, 69, 112, 210], offset);
      const tile = Math.floor(y / tileSize) * columns + Math.floor(x / tileSize);
      const cell = tiles.get(tile) ?? { left: x, top: y, right: x, bottom: y, count: 0 };
      cell.left = Math.min(cell.left, x);
      cell.top = Math.min(cell.top, y);
      cell.right = Math.max(cell.right, x);
      cell.bottom = Math.max(cell.bottom, y);
      cell.count++;
      tiles.set(tile, cell);
    }
    if (y % 96 === 95) {
      if (options.cancelled?.()) return null;
      await options.yield?.();
    }
  }
  const remaining = new Set(tiles.keys()),
    regions = [];
  while (remaining.size) {
    const first = remaining.values().next().value;
    const queue = [first];
    remaining.delete(first);
    let left = width,
      top = height,
      right = 0,
      bottom = 0,
      count = 0;
    for (let index = 0; index < queue.length; index++) {
      const key = queue[index],
        x = key % columns,
        y = Math.floor(key / columns);
      const cell = tiles.get(key);
      left = Math.min(left, cell.left);
      top = Math.min(top, cell.top);
      right = Math.max(right, cell.right + 1);
      bottom = Math.max(bottom, cell.bottom + 1);
      count += cell.count;
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const nextX = x + dx,
          nextY = y + dy,
          next = nextY * columns + nextX;
        if (nextX >= 0 && nextX < columns && nextY >= 0 && remaining.delete(next)) queue.push(next);
      }
    }
    regions.push({ x: left, y: top, width: right - left, height: bottom - top, pixels: count });
  }
  regions.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);
  return {
    changed,
    total: width * height,
    percent: (100 * changed) / (width * height),
    heat,
    bounds: changed ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    regions: regions.slice(0, 12),
    regionCount: regions.length,
  };
}
export function describeBounds(result, threshold = 0, pngChanged = false) {
  const b = result.bounds;
  if (!b && threshold > 0)
    return `No differences exceed the selected threshold (${threshold} / 255).`;
  return b
    ? `Bounds: ${b.x}, ${b.y} · ${b.width} × ${b.height}`
    : pngChanged
      ? "PNG bytes differ; decoded pixels are identical."
      : "Decoded pixels are identical.";
}
