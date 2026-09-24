// Reviewer-facing images derived from decoded RGBA screenshots in the trusted
// reporter. They summarize where pixels changed; they never decide intent.
export const width = 1440;
export const height = 960;
const pink = [255, 69, 112];

/** Merge nearby changed regions into reviewable areas, largest first. */
export function changeAreas(regions, gap = 24) {
  let areas = regions.map((region) => ({ ...region }));
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < areas.length; i++)
      for (let j = i + 1; j < areas.length; j++) {
        const a = areas[i],
          b = areas[j];
        if (
          a.x - gap > b.x + b.width ||
          b.x - gap > a.x + a.width ||
          a.y - gap > b.y + b.height ||
          b.y - gap > a.y + a.height
        )
          continue;
        const x = Math.min(a.x, b.x),
          y = Math.min(a.y, b.y);
        areas[i] = {
          x,
          y,
          width: Math.max(a.x + a.width, b.x + b.width) - x,
          height: Math.max(a.y + a.height, b.y + b.height) - y,
          pixels: a.pixels + b.pixels,
        };
        areas.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  areas = areas.sort((a, b) => b.pixels - a.pixels || a.y - b.y || a.x - b.x);
  return areas;
}

/** Views whose changed areas coincide are usually one shared-component change. */
export function areaKey(areas) {
  const snap = (value) => Math.round(value / 8);
  return areas
    .map((area) => [area.x, area.y, area.width, area.height].map(snap).join(","))
    .sort()
    .join(";");
}

/** A readable 1:1 crop around an area, or null when the area is most of the view. */
export function focusRect(area, { padding = 32, minWidth = 480, minHeight = 200 } = {}) {
  let w = Math.max(minWidth, area.width + padding * 2),
    h = Math.max(minHeight, area.height + padding * 2);
  if (w * h > (width * height) / 2) return null;
  w = Math.min(width, w);
  h = Math.min(height, h);
  const x = Math.round(Math.min(width - w, Math.max(0, area.x + area.width / 2 - w / 2)));
  const y = Math.round(Math.min(height - h, Math.max(0, area.y + area.height / 2 - h / 2)));
  return { x, y, width: w, height: h };
}

export function crop(data, rect) {
  const out = Buffer.alloc(rect.width * rect.height * 4);
  for (let row = 0; row < rect.height; row++) {
    const start = ((rect.y + row) * width + rect.x) * 4;
    out.set(data.subarray(start, start + rect.width * 4), row * rect.width * 4);
  }
  return out;
}

/**
 * The after screenshot, dimmed outside changed areas, with changed pixels tinted
 * pink and each area outlined. Unlike a transparent heatmap, this is legible in
 * a PR comment or by an agent without the interactive viewer.
 */
export function differenceImage(after, heat, areas) {
  const out = Buffer.alloc(width * height * 4);
  const inside = new Uint8Array(width * height);
  const pad = 4;
  for (const area of areas)
    for (let y = Math.max(0, area.y - pad); y < Math.min(height, area.y + area.height + pad); y++)
      inside.fill(
        1,
        y * width + Math.max(0, area.x - pad),
        y * width + Math.min(width, area.x + area.width + pad),
      );
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    let r = after[offset],
      g = after[offset + 1],
      b = after[offset + 2];
    if (heat[offset + 3]) {
      r = Math.round(r * 0.3 + pink[0] * 0.7);
      g = Math.round(g * 0.3 + pink[1] * 0.7);
      b = Math.round(b * 0.3 + pink[2] * 0.7);
    } else if (!inside[index]) {
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = Math.round((r * 0.4 + gray * 0.6) * 0.4);
      g = Math.round((g * 0.4 + gray * 0.6) * 0.4);
      b = Math.round((b * 0.4 + gray * 0.6) * 0.4);
    }
    out[offset] = r;
    out[offset + 1] = g;
    out[offset + 2] = b;
    out[offset + 3] = 255;
  }
  const stroke = 2;
  const paint = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    out.set([...pink, 255], (y * width + x) * 4);
  };
  for (const area of areas) {
    const left = area.x - pad - stroke,
      top = area.y - pad - stroke,
      right = area.x + area.width + pad + stroke - 1,
      bottom = area.y + area.height + pad + stroke - 1;
    for (let s = 0; s < stroke; s++) {
      for (let x = left; x <= right; x++) {
        paint(x, top + s);
        paint(x, bottom - s);
      }
      for (let y = top; y <= bottom; y++) {
        paint(left + s, y);
        paint(right - s, y);
      }
    }
  }
  return out;
}
