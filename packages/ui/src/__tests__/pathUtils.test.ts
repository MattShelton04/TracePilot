import { describe, expect, it } from "vitest";
import {
  normalizePath,
  pathBasename,
  pathDirname,
  sanitizeBranchForPath,
  shortenPath,
} from "../utils/pathUtils";

describe("normalizePath", () => {
  it("converts backslashes to forward slashes", () => {
    expect(normalizePath("C:\\Users\\matt\\project")).toBe("C:/Users/matt/project");
  });
  it("strips trailing slash", () => {
    expect(normalizePath("/home/user/project/")).toBe("/home/user/project");
  });
  it("strips multiple trailing slashes", () => {
    expect(normalizePath("/home/user/project///")).toBe("/home/user/project");
  });
  it("handles mixed separators", () => {
    expect(normalizePath("C:\\Users/matt\\project/")).toBe("C:/Users/matt/project");
  });
  it("handles empty string", () => {
    expect(normalizePath("")).toBe("");
  });
  it("handles single segment", () => {
    expect(normalizePath("project")).toBe("project");
  });
});

describe("pathBasename", () => {
  it("extracts last segment from Unix path", () => {
    expect(pathBasename("/home/user/project")).toBe("project");
  });
  it("extracts last segment from Windows path", () => {
    expect(pathBasename("C:\\Users\\matt\\project")).toBe("project");
  });
  it("handles trailing slash", () => {
    expect(pathBasename("/home/user/project/")).toBe("project");
  });
  it("returns empty for empty string", () => {
    expect(pathBasename("")).toBe("");
  });
  it("returns single segment as-is", () => {
    expect(pathBasename("project")).toBe("project");
  });
});

describe("pathDirname", () => {
  it("returns parent of Unix path", () => {
    expect(pathDirname("/home/user/project")).toBe("/home/user");
  });
  it("returns parent of Windows path", () => {
    expect(pathDirname("C:\\Users\\matt\\project")).toBe("C:/Users/matt");
  });
  it("handles trailing slash", () => {
    expect(pathDirname("/home/user/project/")).toBe("/home/user");
  });
  it("returns empty for single segment", () => {
    expect(pathDirname("project")).toBe("");
  });
  it("returns root for root-level path", () => {
    expect(pathDirname("/project")).toBe("");
  });
});

describe("shortenPath", () => {
  it("shortens long paths to last 2 segments", () => {
    expect(shortenPath("/home/user/projects/tracepilot")).toBe("…/projects/tracepilot");
  });
  it("returns short paths unchanged", () => {
    expect(shortenPath("projects/tracepilot")).toBe("projects/tracepilot");
  });
  it("handles custom segment count", () => {
    expect(shortenPath("/a/b/c/d/e", 3)).toBe("…/c/d/e");
  });
  it("returns empty for empty input", () => {
    expect(shortenPath("")).toBe("");
  });
  it("handles Windows paths", () => {
    expect(shortenPath("C:\\Users\\matt\\projects\\tracepilot")).toBe("…/projects/tracepilot");
  });
  it("returns path as-is if exact number of segments", () => {
    expect(shortenPath("a/b/c", 3)).toBe("a/b/c");
  });
  it("handles 0 segments", () => {
    // If segments is 0, parts.slice(0) returns the whole array, so we get …/a/b/c
    expect(shortenPath("a/b/c", 0)).toBe("…/a/b/c");
  });
  it("handles negative segments", () => {
    // If segments is negative, e.g. -1, parts.slice(-(-1)) => parts.slice(1)
    expect(shortenPath("a/b/c", -1)).toBe("…/b/c");
  });
  it("handles root path", () => {
    expect(shortenPath("/")).toBe("/");
  });
  it("handles trailing slash by ignoring it (normalizePath strips it)", () => {
    expect(shortenPath("a/b/c/", 2)).toBe("…/b/c");
  });
  it("returns entire path if segments is larger than parts.length", () => {
    expect(shortenPath("a/b/c", 10)).toBe("a/b/c");
  });
});

describe("sanitizeBranchForPath", () => {
  it("replaces forbidden characters with hyphens", () => {
    expect(sanitizeBranchForPath("feature/my-branch")).toBe("feature-my-branch");
  });
  it("replaces spaces", () => {
    expect(sanitizeBranchForPath("my branch name")).toBe("my-branch-name");
  });
  it("replaces special git ref characters", () => {
    expect(sanitizeBranchForPath("feat~1^2:test")).toBe("feat-1-2-test");
  });
  it("replaces double dots", () => {
    expect(sanitizeBranchForPath("main..develop")).toBe("main-develop");
  });
  it("collapses consecutive hyphens", () => {
    expect(sanitizeBranchForPath("a///b")).toBe("a-b");
  });
  it("trims whitespace", () => {
    expect(sanitizeBranchForPath("  feature  ")).toBe("feature");
  });
  it("handles clean branch names", () => {
    expect(sanitizeBranchForPath("my-clean-branch")).toBe("my-clean-branch");
  });
});
