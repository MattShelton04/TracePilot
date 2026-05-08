import { describe, expect, it } from "vitest";
import { buildExportFilename } from "../exportFilename";

const FIXED_DATE = new Date("2024-05-17T13:42:09.000Z");
const FIXED_STAMP = "2024-05-17-13-42";

describe("buildExportFilename", () => {
  it("builds a slug from summary using the same shape as ExportTab.vue", () => {
    expect(
      buildExportFilename({
        summary: "Refactor Auth",
        repository: "ignored/repo",
        extension: "tpx.json",
        now: FIXED_DATE,
      }),
    ).toBe(`refactor-auth-${FIXED_STAMP}.tpx.json`);
  });

  it("falls back to repository when summary is missing/empty", () => {
    expect(
      buildExportFilename({
        summary: "",
        repository: "owner/cool-repo",
        extension: "md",
        now: FIXED_DATE,
      }),
    ).toBe(`ownercool-repo-${FIXED_STAMP}.md`);
  });

  it("uses session-export fallback when no inputs are usable", () => {
    expect(
      buildExportFilename({
        summary: null,
        repository: undefined,
        extension: "csv",
        now: FIXED_DATE,
      }),
    ).toBe(`session-export-${FIXED_STAMP}.csv`);
  });

  it("falls back to session-export when slug is only special characters", () => {
    expect(
      buildExportFilename({
        summary: "!!!@@@###",
        extension: "zip",
        now: FIXED_DATE,
      }),
    ).toBe(`session-export-${FIXED_STAMP}.zip`);
  });

  it("strips special characters and collapses whitespace into hyphens", () => {
    expect(
      buildExportFilename({
        summary: "  Hello,   WORLD!! / fix #42  ",
        extension: "md",
        now: FIXED_DATE,
      }),
    ).toBe(`hello-world-fix-42-${FIXED_STAMP}.md`);
  });

  it("truncates very long names to 60 characters", () => {
    const longName = "a".repeat(120);
    const result = buildExportFilename({
      summary: longName,
      extension: "tpx.json",
      now: FIXED_DATE,
    });
    const slug = result.slice(0, result.indexOf(`-${FIXED_STAMP}`));
    expect(slug.length).toBe(60);
    expect(slug).toBe("a".repeat(60));
  });

  it("supports both export extensions used today (tpx.json and zip)", () => {
    const json = buildExportFilename({
      summary: "x",
      extension: "tpx.json",
      now: FIXED_DATE,
    });
    const zip = buildExportFilename({
      summary: "x",
      extension: "zip",
      now: FIXED_DATE,
    });
    expect(json.endsWith(".tpx.json")).toBe(true);
    expect(zip.endsWith(".zip")).toBe(true);
  });

  it("defaults to the current time when `now` is omitted", () => {
    const result = buildExportFilename({ summary: "x", extension: "csv" });
    expect(result).toMatch(/^x-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.csv$/);
  });
});
