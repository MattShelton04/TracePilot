import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chart shared theme styles", () => {
  const cssPath = resolve(__dirname, "../../styles/chart-shared.css");
  const css = readFileSync(cssPath, "utf8");
  const tooltipPath = resolve(
    __dirname,
    "../../../../../packages/ui/src/components/ChartTooltip.vue",
  );
  const tooltip = readFileSync(tooltipPath, "utf8");

  it("uses explicit chart tooltip theme tokens", () => {
    expect(tooltip).toContain("var(--chart-tooltip-bg");
    expect(tooltip).toContain("var(--chart-tooltip-fg");
  });

  it("applies non-opacity-only active bar emphasis", () => {
    expect(css).toContain(".chart-bar--active");
    expect(css).toContain("filter: saturate(1.35) brightness(1.1)");
  });
});
