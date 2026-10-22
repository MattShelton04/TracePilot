import { afterEach, describe, expect, it } from "vitest";
import { buildExportFilename } from "../exportFilename";

// Built from local fields, so the stamp is the same in every timezone.
const FIXED_DATE = new Date(2024, 4, 17, 13, 42, 9);
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
    ).toBe(`owner-cool-repo-${FIXED_STAMP}.md`);
  });

  it("uses session-export fallback when no inputs are usable", () => {
    expect(
      buildExportFilename({
        summary: null,
        repository: undefined,
        extension: "md",
        now: FIXED_DATE,
      }),
    ).toBe(`session-export-${FIXED_STAMP}.md`);
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

  it("keeps a backslash between words too", () => {
    expect(
      buildExportFilename({
        repository: "team\\service",
        extension: "md",
        now: FIXED_DATE,
      }),
    ).toBe(`team-service-${FIXED_STAMP}.md`);
  });

  describe("in another timezone", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    });

    it("stamps the user's local date and time, not UTC", () => {
      // 09:00 on 23 Oct in Brisbane (UTC+10, no daylight saving) is still
      // 22 Oct in UTC.
      process.env.TZ = "Australia/Brisbane";
      expect(
        buildExportFilename({
          summary: "x",
          extension: "md",
          now: new Date("2026-10-22T23:00:00Z"),
        }),
      ).toBe("x-2026-10-23-09-00.md");
    });
  });

  it("defaults to the current time when `now` is omitted", () => {
    const result = buildExportFilename({ summary: "x", extension: "md" });
    expect(result).toMatch(/^x-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.md$/);
  });
});
