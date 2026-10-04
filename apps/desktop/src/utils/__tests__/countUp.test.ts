import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countUp, formatCountable, parseCountable } from "../countUp";

describe("parseCountable / formatCountable", () => {
  it.each([
    ["8699.7M", "4349.9M"],
    ["$8,354.25", "$4,177.13"],
    ["835,425 AIC", "417,713 AIC"],
    ["93.2%", "46.6%"],
    ["+796,350", "+398,175"],
    ["-105,348", "-52,674"],
  ])("keeps the shape of %s while counting", (text, half) => {
    const parsed = parseCountable(text);
    expect(parsed).not.toBeNull();
    expect(formatCountable(parsed!, parsed!.value / 2)).toBe(half);
    expect(formatCountable(parsed!, parsed!.value)).toBe(text);
  });

  it.each(["1h 17m", "26m 41s", "0", "N/A", "—", "Estimated"])("leaves %s alone", (text) => {
    expect(parseCountable(text)).toBeNull();
  });
});

describe("countUp", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function value(text: string) {
    const el = document.createElement("div");
    el.textContent = text;
    return el;
  }

  it("starts at zero and ends on exactly the original text", () => {
    const el = value(" 2,272 ");
    const finish = countUp([el], 600);
    expect(el.textContent).toBe(" 0 ");

    finish();
    expect(el.textContent).toBe(" 2,272 ");
  });

  it("stops touching text that was re-rendered mid-count", () => {
    const el = value("400");
    const finish = countUp([el], 600);
    el.firstChild!.nodeValue = "512";

    finish();
    expect(el.textContent).toBe("512");
  });

  it("skips elements whose text cannot be counted", () => {
    const el = value("1h 17m");
    countUp([el], 600);
    expect(el.textContent).toBe("1h 17m");
    expect(frames).toHaveLength(0);
  });
});
