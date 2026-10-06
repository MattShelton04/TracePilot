import { describe, expect, it } from "vitest";
import { knownSessionSource } from "../useSessionSource";

describe("knownSessionSource", () => {
  const claudeItem = [{ id: "s-1", source: "claudeCode" as const }];

  it("prefers the detail's explicit source", () => {
    expect(knownSessionSource("s-1", { id: "s-1", source: "copilot" }, claudeItem)).toBe("copilot");
  });

  it("keeps a known list source when the detail omits it", () => {
    expect(knownSessionSource("s-1", { id: "s-1" }, claudeItem)).toBe("claudeCode");
  });

  it("ignores a detail for another session", () => {
    expect(knownSessionSource("s-1", { id: "s-2", source: "copilot" }, claudeItem)).toBe(
      "claudeCode",
    );
  });

  it("falls back to Copilot only when loaded data describes the session", () => {
    expect(knownSessionSource("s-1", { id: "s-1" }, [])).toBe("copilot");
    expect(knownSessionSource("s-1", null, [{ id: "s-1" }])).toBe("copilot");
    expect(knownSessionSource("s-1", null, [])).toBeUndefined();
    expect(knownSessionSource(null, null, claudeItem)).toBeUndefined();
  });
});
