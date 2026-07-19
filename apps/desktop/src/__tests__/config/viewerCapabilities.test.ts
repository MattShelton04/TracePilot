import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("viewer capabilities", () => {
  it("allows context timeline reconstruction in popped-out session windows", () => {
    const capability = JSON.parse(
      readFileSync(resolve(process.cwd(), "src-tauri/capabilities/viewer.json"), "utf8"),
    ) as { permissions: string[] };

    expect(capability.permissions).toContain("tracepilot:allow-get-session-context-timeline");
  });
});
