import { describe, expect, it } from "vitest";
import {
  computePanelWidthPx,
  computeScrollInsetPx,
  shouldReserveScrollInset,
} from "../../../components/conversation/panelLayout";

describe("panelLayout", () => {
  it("does not reserve inset below desktop breakpoint", () => {
    expect(shouldReserveScrollInset(959)).toBe(false);
    expect(computeScrollInsetPx(true, 959)).toBe(0);
  });

  it("reserves inset at desktop breakpoint and above", () => {
    expect(shouldReserveScrollInset(960)).toBe(true);
    expect(computeScrollInsetPx(true, 960)).toBe(380);
  });

  it("clamps panel width between min and max", () => {
    expect(computePanelWidthPx(960)).toBe(380);
    expect(computePanelWidthPx(1400)).toBe(532);
    expect(computePanelWidthPx(2400)).toBe(650);
  });

  it("returns zero inset when panel is closed", () => {
    expect(computeScrollInsetPx(false, 1400)).toBe(0);
  });
});

