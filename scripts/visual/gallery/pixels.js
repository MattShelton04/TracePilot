// Dependency-free, bounded pixel analysis. Shared by the browser and Node tests.
globalThis.TracePilotPixels = (() => {
  async function compare(before, after, width, height, options = {}) {
    if (
      width !== 1440 ||
      height !== 960 ||
      before.length !== width * height * 4 ||
      after.length !== before.length
    )
      throw new Error("Expected matching 1440×960 RGBA images");
    const threshold = Math.max(0, Math.min(255, Number(options.threshold) || 0));
    const heat = new Uint8ClampedArray(before.length);
    const tileSize = 32,
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
        tiles.set(tile, (tiles.get(tile) ?? 0) + 1);
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
        left = Math.min(left, x * tileSize);
        top = Math.min(top, y * tileSize);
        right = Math.max(right, Math.min(width, (x + 1) * tileSize));
        bottom = Math.max(bottom, Math.min(height, (y + 1) * tileSize));
        count += tiles.get(key);
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const nextX = x + dx,
            nextY = y + dy,
            next = nextY * columns + nextX;
          if (nextX >= 0 && nextX < columns && nextY >= 0 && remaining.delete(next))
            queue.push(next);
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
      bounds: changed
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
      regions: regions.slice(0, 12),
      regionCount: regions.length,
    };
  }
  function describeBounds(result, threshold = 0, pngChanged = false) {
    const b = result.bounds;
    if (!b && threshold > 0)
      return `No differences exceed the selected threshold (${threshold} / 255).`;
    return b
      ? `Bounds: ${b.x}, ${b.y} · ${b.width} × ${b.height}`
      : pngChanged
        ? "PNG bytes differ; decoded pixels are identical."
        : "Decoded pixels are identical.";
  }
  return { compare, describeBounds };
})();
