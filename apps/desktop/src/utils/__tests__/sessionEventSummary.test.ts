import { modelDisplayName } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import { sessionEventSummary } from "../sessionEventSummary";

const claude = (model: string) => modelDisplayName(model, "claudeCode");
const copilot = (model: string) => modelDisplayName(model, "copilot");

describe("sessionEventSummary", () => {
  it("names the model a Claude Code session started on as elsewhere", () => {
    const event = {
      eventType: "session.start",
      summary: "Session started (model: claude-opus-5-5)",
    };
    expect(sessionEventSummary(event, claude)).toBe("Session started (model: claude-opus-5.5)");
  });

  it("names both models of a Claude Code resume or switch", () => {
    expect(
      sessionEventSummary(
        { eventType: "session.resume", summary: "Session resumed 2× (model: claude-sonnet-4-5)" },
        claude,
      ),
    ).toBe("Session resumed 2× (model: claude-sonnet-4.5)");
    expect(
      sessionEventSummary(
        {
          eventType: "session.model_change",
          summary: "Model changed claude-opus-5-5 → claude-haiku-4-5-20251001",
        },
        claude,
      ),
    ).toBe("Model changed claude-opus-5.5 → claude-haiku-4.5");
  });

  it("leaves Copilot summaries and summaries without a model as recorded", () => {
    const start = {
      eventType: "session.start",
      summary: "Session started (model: claude-opus-4-5)",
    };
    expect(sessionEventSummary(start, copilot)).toBe(start.summary);
    const skill = { eventType: "skill.invoked", summary: "Skill invoked: claude-opus-5-5" };
    expect(sessionEventSummary(skill, claude)).toBe(skill.summary);
  });
});
