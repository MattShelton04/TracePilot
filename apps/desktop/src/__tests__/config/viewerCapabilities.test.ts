import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function viewerPermissions(): string[] {
  const capability = JSON.parse(
    readFileSync(resolve(process.cwd(), "src-tauri/capabilities/viewer.json"), "utf8"),
  ) as { permissions: string[] };
  return capability.permissions;
}

describe("viewer capabilities", () => {
  it("allows context timeline reconstruction in popped-out session windows", () => {
    expect(viewerPermissions()).toContain("tracepilot:allow-get-session-context-timeline");
  });

  it("allows every Overview section in popped-out session windows", () => {
    expect(viewerPermissions()).toEqual(
      expect.arrayContaining([
        "tracepilot:allow-get-session-checkpoints",
        "tracepilot:allow-get-session-plan",
        "tracepilot:allow-get-session-background-tasks",
        "tracepilot:allow-get-session-file-history",
        "tracepilot:allow-get-session-file-version",
        "tracepilot:allow-get-shutdown-metrics",
        "tracepilot:allow-get-session-incidents",
      ]),
    );
  });
});
