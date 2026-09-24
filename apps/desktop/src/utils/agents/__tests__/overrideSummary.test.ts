import { describe, expect, it } from "vitest";
import { describeOverrideChange, describeOverrideValues } from "../overrideSummary";

const model = (value: string) => ({ model: value, effortLevel: null, contextTier: null });

describe("describeOverrideValues", () => {
  it("lists only the keys that are set", () => {
    expect(
      describeOverrideValues({ model: "gpt-5.5", effortLevel: "high", contextTier: null }),
    ).toBe("model gpt-5.5 · effort high");
    expect(
      describeOverrideValues({ model: null, effortLevel: null, contextTier: null }),
    ).toBeNull();
    expect(describeOverrideValues(null)).toBeNull();
  });
});

describe("describeOverrideChange", () => {
  const base = { agentType: "explore", wasDisabled: false, disabled: false };

  it("confirms a new override with its values and where it was written", () => {
    expect(
      describeOverrideChange({
        ...base,
        previous: null,
        next: model("gpt-5.6-luna"),
        settingsPath: "C:/Users/me/.copilot/settings.json",
      }),
    ).toEqual({
      title: "Override saved for explore",
      message: "Now runs with model gpt-5.6-luna. Written to C:/Users/me/.copilot/settings.json.",
    });
  });

  it("reports a removed override, including one that only disabled the agent", () => {
    expect(describeOverrideChange({ ...base, previous: model("x"), next: null }).title).toBe(
      "Override removed for explore",
    );
    expect(
      describeOverrideChange({ ...base, previous: null, next: null, wasDisabled: true }).title,
    ).toBe("Override removed for explore");
  });

  it("describes a disable-only change without claiming the values changed", () => {
    const summary = describeOverrideChange({
      ...base,
      previous: model("x"),
      next: model("x"),
      disabled: true,
    });
    expect(summary.title).toBe("explore updated");
    expect(summary.message).toBe("Disabled: the CLI will not run it.");
  });
});
