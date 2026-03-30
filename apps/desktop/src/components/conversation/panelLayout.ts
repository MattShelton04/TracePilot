const PANEL_MIN_WIDTH_PX = 380;
const PANEL_MAX_WIDTH_PX = 650;
const PANEL_WIDTH_VW_RATIO = 0.38;
const MOBILE_BREAKPOINT_PX = 960;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function shouldReserveScrollInset(viewportWidth: number): boolean {
  return viewportWidth >= MOBILE_BREAKPOINT_PX;
}

export function computePanelWidthPx(viewportWidth: number): number {
  if (!shouldReserveScrollInset(viewportWidth)) return viewportWidth;
  return clamp(viewportWidth * PANEL_WIDTH_VW_RATIO, PANEL_MIN_WIDTH_PX, PANEL_MAX_WIDTH_PX);
}

export function computeScrollInsetPx(isPanelOpen: boolean, viewportWidth: number): number {
  if (!isPanelOpen || !shouldReserveScrollInset(viewportWidth)) {
    return 0;
  }
  return computePanelWidthPx(viewportWidth);
}

