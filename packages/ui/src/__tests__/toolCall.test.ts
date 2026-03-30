import { describe, expect, it } from "vitest";
import { formatArgsSummary } from "../utils/toolCall";

describe("formatArgsSummary", () => {
  it("summarizes read_agent from agent_id", () => {
    const summary = formatArgsSummary({ agent_id: "explore-backend" }, "read_agent");
    expect(summary).toBe("explore-backend");
  });

  it("falls back to agent_name and name for read_agent", () => {
    expect(formatArgsSummary({ agent_name: "review-agent" }, "read_agent")).toBe("review-agent");
    expect(formatArgsSummary({ name: "task-agent" }, "read_agent")).toBe("task-agent");
  });
});
