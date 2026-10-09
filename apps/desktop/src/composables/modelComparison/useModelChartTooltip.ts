import { reactive } from "vue";

/** One model's (or one bucket's) details, shown as labelled rows. */
export interface ModelTooltipContent {
  title: string;
  /** Series colour shown beside the title. */
  color?: string;
  /** Draw the swatch as a ring: the row is priced in USD, not AI Credits. */
  hollow?: boolean;
  rows: Array<{ label: string; value: string; color?: string }>;
}

export interface ModelTooltipState {
  visible: boolean;
  x: number;
  y: number;
  content: ModelTooltipContent | null;
}

/**
 * Pointer-following tooltip state for the Models page charts. Unlike the
 * shared single-line `ChartTooltip`, these carry several labelled values.
 */
export function useModelChartTooltip() {
  const tooltip = reactive<ModelTooltipState>({ visible: false, x: 0, y: 0, content: null });

  function show(event: { clientX: number; clientY: number }, content: ModelTooltipContent) {
    tooltip.x = event.clientX;
    tooltip.y = event.clientY;
    tooltip.content = content;
    tooltip.visible = true;
  }

  function hide() {
    tooltip.visible = false;
  }

  return { tooltip, show, hide };
}
