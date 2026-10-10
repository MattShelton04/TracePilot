import { describe, expect, it } from "vitest";
import { settledAgentStatus } from "../agentEndState";

describe("settledAgentStatus", () => {
  it("marks an unfinished agent unreported once nothing more can be recorded", () => {
    expect(settledAgentStatus("in-progress", false)).toBe("unreported");
  });

  it("keeps running agents running while the session may still record", () => {
    expect(settledAgentStatus("in-progress", true)).toBe("in-progress");
  });

  it("leaves settled statuses alone", () => {
    for (const status of ["completed", "failed", "cancelled", "idle", "main", "unlinked"]) {
      expect(settledAgentStatus(status, false)).toBe(status);
    }
  });
});
