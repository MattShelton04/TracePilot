import { describe, expect, it } from "vitest";
import { resolveEffectiveConfig } from "../effective";
import { findPlaceholders, renderPromptPreview } from "../placeholders";
import { fields, settings } from "./fixtures";

describe("resolveEffectiveConfig", () => {
  it("prefers the /subagents override and says what it shadows", () => {
    const config = resolveEffectiveConfig(
      fields({ models: ["gpt-5.4-mini", "claude-haiku-4.5"], reasoningEffort: "low" }),
      { model: "gpt-5.6-luna", effortLevel: "inherit", contextTier: null },
      settings(),
    );
    expect(config.models).toEqual([
      {
        value: "gpt-5.6-luna",
        source: "settings",
        detail: "from /subagents setting; definition says gpt-5.4-mini",
      },
    ]);
    expect(config.effort.value).toBe("high");
    expect(config.effort.detail).toContain("inherits the session effort");
    expect(config.contextTier).toEqual({ value: "default", source: "cli", detail: "CLI default" });
  });

  it("uses definition fallbacks and the required model policy without an override", () => {
    const config = resolveEffectiveConfig(
      fields({
        models: ["claude-opus-5", "gpt-5.6-luna"],
        modelPolicy: "required",
        tools: ["view"],
      }),
      null,
      settings(),
    );
    expect(config.models.map((m) => m.value)).toEqual(["claude-opus-5", "gpt-5.6-luna"]);
    expect(config.models[1].detail).toBe("fallback 1 from the definition");
    expect(config.modelPolicyRequired).toBe(true);
    expect(config.effort).toMatchObject({ value: "high", source: "session" });
    expect(config.tools.value).toEqual(["view"]);
  });

  it("falls back to the session model or the CLI when nothing is declared", () => {
    expect(resolveEffectiveConfig(fields(), null, settings()).models[0]).toMatchObject({
      value: "gpt-5.6-luna",
      source: "session",
    });
    const embedded = resolveEffectiveConfig(null, null, settings());
    expect(embedded.models[0]).toMatchObject({ value: null, source: "cli" });
    expect(embedded.tools.source).toBe("cli");
  });
});

describe("prompt placeholders", () => {
  it("finds and resolves known placeholders outside and inside code", () => {
    const prompt =
      "Use {{grepToolName}} and {{copilot:memories}}.\n\n```\nrun {{shellToolName}}\n```";
    expect(findPlaceholders(prompt)).toEqual([
      { name: "grepToolName", resolved: "grep", count: 1 },
      { name: "copilot:memories", resolved: null, count: 1 },
      { name: "shellToolName", resolved: "bash / powershell", count: 1 },
    ]);
    expect(renderPromptPreview(prompt)).toBe(
      "Use `grep` and `{{copilot:memories}}`.\n\n```\nrun bash / powershell\n```",
    );
  });
});
