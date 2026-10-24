import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatArgsSummary } from "../utils/toolCall";

interface SummaryCase {
  name: string;
  tool: string;
  args: unknown;
  expected: string;
}

// Rust's `compute_args_summary` (crates/tracepilot-core/src/turns/args_summary)
// reads the same table: the app shows the server's summary in place of this
// one, and exports use it, so both must agree on every case.
const casesPath = resolve(
  __dirname,
  "../../../../crates/tracepilot-core/tests/fixtures/contracts/tool-args-summary.json",
);
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as SummaryCase[];

describe("formatArgsSummary shared case table", () => {
  it("has uniquely named cases", () => {
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
  });

  it.each(cases)("$name", ({ tool, args, expected }) => {
    expect(formatArgsSummary(args, tool)).toBe(expected);
  });
});
