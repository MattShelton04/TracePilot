/**
 * Where a menu anchored to a trigger goes: below it when it fits, above it
 * when only that fits, otherwise on the roomier side with a height that
 * scrolls. Kept inside the window, `margin` from every edge.
 */
export interface MenuPlacement {
  x: number;
  y: number;
  maxHeight: number;
}

export function placeAnchoredMenu(
  anchor: { left: number; top: number; bottom: number },
  /** The menu's width and its content's full height (`scrollHeight`). */
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  { gap = 4, margin = 8, maxHeight = 360 } = {},
): MenuPlacement {
  const height = Math.min(menu.height, maxHeight);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const x = Math.max(margin, Math.min(anchor.left, viewport.width - menu.width - margin));
  if (height <= below || below >= above) {
    return { x, y: anchor.bottom + gap, maxHeight: Math.min(maxHeight, below) };
  }
  const shown = Math.min(height, above);
  return { x, y: anchor.top - gap - shown, maxHeight: Math.min(maxHeight, above) };
}
