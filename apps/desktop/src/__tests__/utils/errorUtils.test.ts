import { describe, expect, it } from "vitest";
import { toErrorMessage } from "@/utils/errors";

describe("toErrorMessage", () => {
  it("returns an Error message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string value", () => {
    expect(toErrorMessage("plain string")).toBe("plain string");
  });

  it("uses a message property on non-Error objects", () => {
    expect(toErrorMessage({ message: "from object" })).toBe("from object");
  });

  it("falls back when no message is available", () => {
    expect(toErrorMessage({})).toBe("Unexpected error");
  });

  it("respects a custom fallback", () => {
    expect(toErrorMessage({}, "Custom fallback")).toBe("Custom fallback");
  });
});
