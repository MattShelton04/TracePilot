import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  costSplit,
  distinctFilePaths,
  filterFileTree,
  folderPaths,
  formatShare,
  idlePercent,
  idleScale,
  idleTicks,
  stackDots,
} from "@/utils/metricsView";

describe("costSplit", () => {
  const price = (
    model: string,
    usage: { inputTokens?: number | null; outputTokens?: number | null },
  ) => ({
    inputCost: model === "free" ? 0 : (usage.inputTokens ?? 0) * 0.01,
    cachedInputCost: 0,
    cacheWriteCost: 0,
    outputCost: model === "free" ? 0 : (usage.outputTokens ?? 0) * 0.03,
    reasoningCost: 0,
    totalCost: null,
  });

  it("splits by kind and model, and lists models without prices", () => {
    const split = costSplit(
      {
        a: { usage: { inputTokens: 100, outputTokens: 0 } },
        b: { usage: { inputTokens: 0, outputTokens: 100 } },
        free: { usage: { inputTokens: 10, outputTokens: 10 } },
        idle: { usage: { inputTokens: 0, outputTokens: 0 } },
      },
      price as never,
    );
    expect(split?.byModel).toEqual({ a: 0.25, b: 0.75 });
    expect(split?.byKind.fresh).toBe(0.25);
    expect(split?.byKind.output).toBe(0.75);
    expect(split?.unpriced).toEqual(["free"]);
  });

  it("is null when nothing is priced", () => {
    expect(costSplit({ free: { usage: { inputTokens: 10 } } }, price as never)).toBeNull();
  });
});

describe("file tree", () => {
  it("roots paths at the repository and keeps absolute paths outside it", () => {
    const tree = buildFileTree(
      ["/repo/src/a.ts", "/repo/src/b.ts", "/elsewhere/notes.md", "/repo/src/a.ts"],
      ["/repo"],
    );
    expect(tree.files).toBe(3);
    // Folders outside the repository stay absolute and come last.
    expect(tree.children.map((c) => c.name)).toEqual(["src", "/elsewhere"]);
    expect(tree.children[0].children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
    expect(folderPaths(tree)).toEqual(["src", "/elsewhere"]);
  });

  it("counts one file once whatever its separators or drive-letter case", () => {
    const spellings = [
      "C:\\git\\repo\\src\\a.ts",
      "C:/git/repo/src/a.ts",
      "c:\\git\\repo\\src\\a.ts",
    ];
    const inRepo = buildFileTree([...spellings, "C:\\git\\repo\\src\\\\b.ts"], ["C:\\git\\repo"]);
    expect(inRepo.files).toBe(2);
    expect(inRepo.children[0]).toMatchObject({ name: "src", files: 2 });
    expect(inRepo.children[0].children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);

    // Outside every root, the spellings share one `C:/…` chain.
    const outside = buildFileTree(spellings, []);
    expect(outside.files).toBe(1);
    expect(outside.children.map((c) => c.name)).toEqual(["C:/git/repo/src"]);
  });

  it("keeps POSIX paths that differ only in case apart", () => {
    const tree = buildFileTree(["/repo/src/A.ts", "/repo/src/a.ts", "/repo//src/a.ts"], ["/repo"]);
    expect(tree.files).toBe(2);
    expect(tree.children[0].children.map((c) => c.name)).toEqual(["a.ts", "A.ts"]);
  });

  it("filters to matching files and compacts the folders left", () => {
    const tree = buildFileTree(["a/b/one.ts", "a/c/two.ts"], []);
    expect(tree.children[0].name).toBe("a");
    const filtered = filterFileTree(tree, "TWO");
    expect(filtered?.children[0].name).toBe("a/c");
    expect(filtered?.files).toBe(1);
    expect(filterFileTree(tree, "three")).toBeNull();
    expect(filterFileTree(tree, "  ")).toBe(tree);
  });
});

describe("idle scale", () => {
  it("covers every value with whole ticks", () => {
    const scale = idleScale([90, 4000]);
    expect(10 ** scale.lo).toBe(60);
    expect(10 ** scale.hi).toBeCloseTo(6 * 3600);
    expect(idlePercent(60, scale)).toBe(0);
    expect(idlePercent(1e9, scale)).toBe(100);
    expect(idleTicks(scale, 1000).map((t) => t.label)).toEqual(["1m", "5m", "30m", "1h", "6h"]);
    // Narrow plots drop ticks that would collide.
    expect(idleTicks(scale, 120).length).toBeLessThan(5);
  });

  it("stacks dots that would overlap", () => {
    expect(stackDots([10, 10.1, 50, 10], 1000, 9)).toEqual([0, 1, 0, 2]);
  });
});

describe("distinctFilePaths", () => {
  it("keeps one spelling per file, as the Metrics tree counts them", () => {
    const paths = [
      "C:\\git\\repo\\src\\a.ts",
      "c:/git/repo/src/a.ts",
      "C:/git//repo/src/a.ts",
      "src/b.ts",
      "/home/u/A.ts",
      "/home/u/a.ts",
    ];
    expect(distinctFilePaths(paths)).toEqual([
      "C:\\git\\repo\\src\\a.ts",
      "src/b.ts",
      "/home/u/A.ts",
      "/home/u/a.ts",
    ]);
    expect(distinctFilePaths(paths).length).toBe(buildFileTree(paths, ["C:/git/repo"]).files);
  });
});

describe("formatShare", () => {
  it("never reads a sliver as 0% or nearly all as 100%", () => {
    expect(formatShare(0.04)).toBe("<0.1%");
    expect(formatShare(42.66)).toBe("42.7%");
    expect(formatShare(99.94)).toBe("99.9%");
    expect(formatShare(99.96)).toBe(">99.9%");
    expect(formatShare(100)).toBe("100%");
    expect(formatShare(130)).toBe("130%");
  });
});
