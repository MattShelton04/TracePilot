import { reactive } from "vue";

export interface ChartTooltipState {
  visible: boolean;
  pinned: boolean;
  x: number;
  y: number;
  content: string;
  chartId: string;
  highlightIndex: number;
}

export interface UseChartTooltipReturn {
  /** Reactive tooltip state — bind to template for rendering. */
  tooltip: ChartTooltipState;
  /**
   * Capture a viewport-relative pointer position. The shared ChartTooltip
   * measures and clamps its rendered content to the viewport.
   */
  positionTooltip: (event: MouseEvent, container: HTMLElement) => void;
  /** Reset tooltip to hidden/unpinned state. */
  dismissTooltip: () => void;
  /**
   * Find nearest data point by X coordinate in SVG space and show tooltip.
   * Uses `closest(containerSelector)` to locate the positioning ancestor.
   */
  onChartMouseMove: (
    event: MouseEvent,
    coords: { x: number }[],
    formatContent: (idx: number) => string,
    chartId: string,
    containerSelector?: string,
  ) => void;
  /**
   * Pin/unpin tooltip on click. Delegates to `onChartMouseMove` for content.
   */
  onChartClick: (
    event: MouseEvent,
    coords: { x: number }[],
    formatContent: (idx: number) => string,
    chartId: string,
    containerSelector?: string,
  ) => void;
  /**
   * Show tooltip on non-SVG bar/element hover (mouseenter).
   */
  onBarMouseEnter: (
    event: MouseEvent,
    content: string,
    chartId: string,
    containerSelector?: string,
  ) => void;
  /**
   * Find the index of the value in `values` closest to `target`.
   * Useful for custom chart handlers that need nearest-point logic.
   */
  findNearestIndex: (values: number[], target: number) => number;
}

/**
 * Composable for chart tooltip state and interaction handlers.
 *
 * Each call creates independent per-instance state — safe for multiple
 * chart views rendered simultaneously.
 *
 * @example
 * ```ts
 * const { tooltip, dismissTooltip, onChartMouseMove, onChartClick } = useChartTooltip();
 * ```
 */
export function useChartTooltip(): UseChartTooltipReturn {
  const tooltip = reactive<ChartTooltipState>({
    visible: false,
    pinned: false,
    x: 0,
    y: 0,
    content: "",
    chartId: "",
    highlightIndex: -1,
  });

  function positionTooltip(event: MouseEvent, _container: HTMLElement): void {
    const viewportWidth = typeof window === "undefined" ? event.clientX : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? event.clientY : window.innerHeight;
    tooltip.x = Math.min(Math.max(event.clientX, 0), viewportWidth);
    tooltip.y = Math.min(Math.max(event.clientY, 0), viewportHeight);
  }

  function dismissTooltip(): void {
    tooltip.visible = false;
    tooltip.pinned = false;
    tooltip.chartId = "";
    tooltip.highlightIndex = -1;
  }

  function findNearestIndex(values: number[], target: number): number {
    if (values.length === 0) return -1;
    let bestIdx = 0;
    let bestDist = Math.abs(target - values[0]);
    for (let i = 1; i < values.length; i++) {
      const d = Math.abs(target - values[i]);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function onChartMouseMove(
    event: MouseEvent,
    coords: { x: number }[],
    formatContent: (idx: number) => string,
    chartId: string,
    containerSelector = ".tooltip-area",
  ): void {
    if (tooltip.pinned) return;
    const svg = (event.target as SVGElement)?.closest("svg");
    const container = (event.target as SVGElement)?.closest(containerSelector) as HTMLElement;
    if (!svg || !container || coords.length === 0) return;

    const ctm = svg.getScreenCTM();
    if (!ctm) return;

    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const svgPt = pt.matrixTransform(ctm.inverse());

    const bestIdx = findNearestIndex(
      coords.map((c) => c.x),
      svgPt.x,
    );
    if (bestIdx < 0) return;

    tooltip.visible = true;
    tooltip.content = formatContent(bestIdx);
    tooltip.chartId = chartId;
    tooltip.highlightIndex = bestIdx;
    positionTooltip(event, container);
  }

  function onChartClick(
    event: MouseEvent,
    coords: { x: number }[],
    formatContent: (idx: number) => string,
    chartId: string,
    containerSelector = ".tooltip-area",
  ): void {
    if (tooltip.pinned && tooltip.chartId === chartId) {
      tooltip.pinned = false;
      return;
    }
    tooltip.pinned = false;
    onChartMouseMove(event, coords, formatContent, chartId, containerSelector);
    // Only pin if onChartMouseMove actually showed the tooltip
    if (tooltip.visible) {
      tooltip.pinned = true;
    }
  }

  function onBarMouseEnter(
    event: MouseEvent,
    content: string,
    chartId: string,
    containerSelector = ".tooltip-area",
  ): void {
    if (tooltip.pinned) return;
    const container = (event.target as HTMLElement)?.closest(containerSelector) as HTMLElement;
    if (!container) return;
    tooltip.visible = true;
    tooltip.content = content;
    tooltip.chartId = chartId;
    tooltip.highlightIndex = -1;
    positionTooltip(event, container);
  }

  return {
    tooltip,
    positionTooltip,
    dismissTooltip,
    onChartMouseMove,
    onChartClick,
    onBarMouseEnter,
    findNearestIndex,
  };
}
