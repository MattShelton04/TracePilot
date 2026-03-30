import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("chart shared theme styles", () => {
  const cssPath = resolve(__dirname, "../../styles/chart-shared.css");
  const css = readFileSync(cssPath, "utf8");

  it("uses explicit chart tooltip theme tokens", () => {
    expect(css).toContain("var(--chart-tooltip-bg");
    expect(css).toContain("var(--chart-tooltip-fg");
  });

  it("applies non-opacity-only active bar emphasis", () => {
    expect(css).toContain(".chart-bar--active");
    expect(css).toContain("filter: saturate(1.35) brightness(1.1)");
  });
});
