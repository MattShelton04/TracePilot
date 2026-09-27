import type { ReleaseManifestEntry } from "@tracepilot/types";
import { describe, expect, it } from "vitest";
import {
  displayVersion,
  entriesInRange,
  parseVersion,
  splitReleaseNote,
} from "@/utils/releaseNotes";

function entry(version: string): ReleaseManifestEntry {
  return { version, date: "2026-01-01", notes: { added: [], changed: [], fixed: [] } };
}

const entries = ["0.8.0", "0.10.0", "0.8.2", "0.9.0", "0.8.1"].map(entry);

describe("releaseNotes", () => {
  it("parses release versions and rejects development builds", () => {
    expect(parseVersion("0.9.0")).toEqual([0, 9, 0]);
    expect(parseVersion("v1.2.3-beta.1")).toEqual([1, 2, 3]);
    expect(parseVersion("dev")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("selects releases after the previous version up to the current one, newest first", () => {
    expect(entriesInRange(entries, "0.8.1", "0.10.0").map((e) => e.version)).toEqual([
      "0.10.0",
      "0.9.0",
      "0.8.2",
    ]);
  });

  it("shows only the current release when the previous version is unknown", () => {
    expect(entriesInRange(entries, "dev", "0.9.0").map((e) => e.version)).toEqual(["0.9.0"]);
    expect(entriesInRange(entries, "dev", "1.0.0")).toEqual([]);
  });

  it("lists every release for a development build's history", () => {
    expect(entriesInRange(entries, "0.0.0", "dev")).toHaveLength(entries.length);
  });

  it("prefixes only release versions", () => {
    expect(displayVersion("0.9.0")).toBe("v0.9.0");
    expect(displayVersion("v0.9.0")).toBe("v0.9.0");
    expect(displayVersion("dev")).toBe("dev");
  });

  it("splits a short leading title from its description", () => {
    expect(splitReleaseNote("Agents explorer: Browse agents")).toEqual({
      title: "Agents explorer",
      body: "Browse agents",
    });
    expect(splitReleaseNote("No title here")).toEqual({ title: null, body: "No title here" });
    expect(splitReleaseNote(`${"x".repeat(90)}: body`).title).toBeNull();
  });
});
