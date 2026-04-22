/**
 * Pure geometry helpers for `ModelComparisonView` charts.
 *
 * Extracted from `useModelComparison` in Wave 33 to keep the composable
 * focused on state + derivations. All functions are pure and have no
 * dependency on component state.
 */

export const RADAR_CX = 150;
export const RADAR_CY = 130;
export const RADAR_R = 90;
export const RADAR_AXES = ["Token Vol.", "Cache Eff.", "Premium Req.", "Cost Eff.", "Token Share"];

export const SCATTER_W = 500;
export const SCATTER_H = 250;
export const SCATTER_PAD = { top: 20, right: 30, bottom: 40, left: 70 };

export function radarPoint(axisIdx: number, value: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * axisIdx) / 5 - Math.PI / 2;
  return {
    x: RADAR_CX + Math.cos(angle) * RADAR_R * value,
    y: RADAR_CY + Math.sin(angle) * RADAR_R * value,
  };
}

export function radarPolygon(values: number[]): string {
  return values
    .map((v, i) => {
      const p = radarPoint(i, v);
      return `${p.x},${p.y}`;
    })
    .join(" ");
}

export function radarAxisEnd(idx: number): { x: number; y: number } {
  return radarPoint(idx, 1);
}

export function radarLabelPos(idx: number): { x: number; y: number; anchor: string } {
  const p = radarPoint(idx, 1.2);
  const angle = (Math.PI * 2 * idx) / 5 - Math.PI / 2;
  let anchor = "middle";
  if (Math.cos(angle) > 0.3) anchor = "start";
  else if (Math.cos(angle) < -0.3) anchor = "end";
  return { x: p.x, y: p.y, anchor };
}

export function scatterX(tokens: number, maxT: number): number {
  return SCATTER_PAD.left + (tokens / maxT) * (SCATTER_W - SCATTER_PAD.left - SCATTER_PAD.right);
}

export function scatterY(cost: number, maxC: number): number {
  return (
    SCATTER_H -
    SCATTER_PAD.bottom -
    (cost / maxC) * (SCATTER_H - SCATTER_PAD.top - SCATTER_PAD.bottom)
  );
}

export function scatterRadius(cacheHitRate: number): number {
  return 6 + (cacheHitRate / 100) * 14;
}
