import type { CodeImpactData } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  codeDayRows,
  extensionLabel,
  fileTypeRows,
  fileTypeSplit,
  OTHER_TYPE_COLOR,
  splitFilePath,
} from "@/utils/codeImpact";

describe("codeDayRows", () => {
  it("zero-fills quiet days with added and removed lines", () => {
    const data = {
      changesByDay: [{ date: "2026-03-02", additions: 40, deletions: 10 }],
    } as CodeImpactData;
    expect(codeDayRows(data, ["2026-03-01", "2026-03-02"]).map((row) => row.values)).toEqual([
      [0, 0],
      [40, 10],
    ]);
  });
});

describe("file types", () => {
  const breakdown = ["ts", "rs", "vue", "md", "py", "css", "json", "(no ext)"].map(
    (extension, i) => ({
      extension,
      count: 80 - i * 10,
      percentage: 0,
    }),
  );

  it("labels bare and dotted extensions alike", () => {
    expect(extensionLabel("ts")).toBe(".ts");
    expect(extensionLabel(".ts")).toBe(".ts");
    expect(extensionLabel("(no ext)")).toBe("no extension");
  });

  it("colours the six leading types and greys the rest", () => {
    const rows = fileTypeRows(breakdown);
    expect(rows[0]).toMatchObject({ label: ".ts", count: 80 });
    expect(rows.slice(0, 6).every((row) => row.color !== OTHER_TYPE_COLOR)).toBe(true);
    expect(rows.slice(6).every((row) => row.color === OTHER_TYPE_COLOR)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(100);
  });

  it("folds the grey types into one segment of the split bar", () => {
    const split = fileTypeSplit(fileTypeRows(breakdown));
    expect(split).toHaveLength(7);
    expect(split[6]).toMatchObject({ label: "2 other types", count: 30, color: OTHER_TYPE_COLOR });
  });

  it("needs no other segment when every type has a colour", () => {
    expect(fileTypeSplit(fileTypeRows(breakdown.slice(0, 3)))).toHaveLength(3);
  });
});

describe("splitFilePath", () => {
  it("puts the name first and keeps the end of the folder", () => {
    expect(splitFilePath("C:\\repo\\apps\\desktop\\src\\App.vue")).toEqual({
      name: "App.vue",
      folder: "…/desktop/src",
    });
    expect(splitFilePath("src/App.vue")).toEqual({ name: "App.vue", folder: "src" });
    expect(splitFilePath("README.md")).toEqual({ name: "README.md", folder: "" });
  });
});
