import { formatNumber } from "@tracepilot/ui";
import { describe, expect, it } from "vitest";
import { plural } from "../format";

describe("plural", () => {
  it("agrees the noun with the count", () => {
    expect(plural(0, "turn")).toBe("0 turns");
    expect(plural(1, "turn")).toBe("1 turn");
    expect(plural(2, "turn")).toBe("2 turns");
  });

  it("takes an irregular plural", () => {
    expect(plural(1, "entry", "entries")).toBe("1 entry");
    expect(plural(3, "entry", "entries")).toBe("3 entries");
  });

  it("formats the count without changing which noun it takes", () => {
    expect(plural(1, "tool", undefined, formatNumber)).toBe("1 tool");
    expect(plural(1500, "tool", undefined, formatNumber)).toBe(`${formatNumber(1500)} tools`);
  });
});
