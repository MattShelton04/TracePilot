import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { type TimeRangedItem, useParallelAgentDetection } from "../useParallelAgentDetection";

describe("useParallelAgentDetection", () => {
  it("returns empty groups for empty array", () => {
    const items = ref<TimeRangedItem[]>([]);
    const { groups, parallelIds, idToLabel } = useParallelAgentDetection(items);

    expect(groups.value).toEqual([]);
    expect(parallelIds.value.size).toBe(0);
    expect(idToLabel.value.size).toBe(0);
  });

  it("returns empty groups for single item", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    expect(groups.value).toEqual([]);
    expect(parallelIds.value.size).toBe(0);
  });

  it("returns empty groups for two non-overlapping items", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:06:00Z", completedAt: "2024-01-01T10:10:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    expect(groups.value).toEqual([]);
    expect(parallelIds.value.size).toBe(0);
  });

  it("detects two overlapping items", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
    ]);
    const { groups, parallelIds, idToLabel } = useParallelAgentDetection(items);

    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].label).toBe("Parallel Group A");
    expect(groups.value[0].ids).toHaveLength(2);
    expect(groups.value[0].ids).toContain("a1");
    expect(groups.value[0].ids).toContain("a2");

    expect(parallelIds.value.size).toBe(2);
    expect(parallelIds.value.has("a1")).toBe(true);
    expect(parallelIds.value.has("a2")).toBe(true);

    expect(idToLabel.value.get("a1")).toBe("Parallel Group A");
    expect(idToLabel.value.get("a2")).toBe("Parallel Group A");
  });

  it("handles transitive overlap (A overlaps B, B overlaps C → all in one group)", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:08:00Z" },
      { id: "a3", startedAt: "2024-01-01T10:06:00Z", completedAt: "2024-01-01T10:10:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // All three should be in one group due to transitivity
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(3);
    expect(groups.value[0].ids).toContain("a1");
    expect(groups.value[0].ids).toContain("a2");
    expect(groups.value[0].ids).toContain("a3");

    expect(parallelIds.value.size).toBe(3);
  });

  it("separates independent overlapping pairs into different groups", () => {
    const items = ref<TimeRangedItem[]>([
      // Group 1: a1 and a2 overlap
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
      // Group 2: a3 and a4 overlap (independent from Group 1)
      { id: "a3", startedAt: "2024-01-01T10:10:00Z", completedAt: "2024-01-01T10:15:00Z" },
      { id: "a4", startedAt: "2024-01-01T10:12:00Z", completedAt: "2024-01-01T10:17:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    expect(groups.value).toHaveLength(2);

    // Check first group
    const group1 = groups.value.find((g) => g.label === "Parallel Group A");
    expect(group1).toBeDefined();
    if (!group1) throw new Error("Parallel Group A not found");
    expect(group1.ids).toHaveLength(2);
    expect(group1.ids).toContain("a1");
    expect(group1.ids).toContain("a2");

    // Check second group
    const group2 = groups.value.find((g) => g.label === "Parallel Group B");
    expect(group2).toBeDefined();
    if (!group2) throw new Error("Parallel Group B not found");
    expect(group2.ids).toHaveLength(2);
    expect(group2.ids).toContain("a3");
    expect(group2.ids).toContain("a4");

    expect(parallelIds.value.size).toBe(4);
  });

  it("excludes independent item from parallel groups", () => {
    const items = ref<TimeRangedItem[]>([
      // a1 and a2 overlap
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
      // a3 is independent (no overlap)
      { id: "a3", startedAt: "2024-01-01T10:10:00Z", completedAt: "2024-01-01T10:15:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(2);
    expect(groups.value[0].ids).toContain("a1");
    expect(groups.value[0].ids).toContain("a2");

    // a3 should not be in parallelIds
    expect(parallelIds.value.size).toBe(2);
    expect(parallelIds.value.has("a3")).toBe(false);
  });

  it("filters out items with missing startedAt", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: null, completedAt: "2024-01-01T10:07:00Z" },
      { id: "a3", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:08:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // a2 should be filtered out, leaving a1 and a3 to overlap
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(2);
    expect(groups.value[0].ids).toContain("a1");
    expect(groups.value[0].ids).toContain("a3");

    expect(parallelIds.value.has("a2")).toBe(false);
  });

  it("filters out items with invalid timestamps (NaN)", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "invalid-date", completedAt: "2024-01-01T10:07:00Z" },
      { id: "a3", startedAt: "2024-01-01T10:03:00Z", completedAt: "also-invalid" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // Both a2 and a3 should be filtered out (invalid timestamps)
    expect(groups.value).toEqual([]);
    expect(parallelIds.value.size).toBe(0);
  });

  it("uses durationMs as fallback when completedAt is missing", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", durationMs: 5 * 60 * 1000 }, // 5 minutes
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", durationMs: 4 * 60 * 1000 }, // 4 minutes
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // a1 ends at 10:05, a2 starts at 10:03 → overlap
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(2);
    expect(parallelIds.value.size).toBe(2);
  });

  it("treats items without completedAt or durationMs as instant (start === end)", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z" }, // No completedAt, no durationMs
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // a2 is treated as instant at 10:03, which overlaps with a1 (10:00-10:05)
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toContain("a1");
    expect(groups.value[0].ids).toContain("a2");
    expect(parallelIds.value.size).toBe(2);
  });

  it("respects custom label prefix option", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
    ]);
    const { groups } = useParallelAgentDetection(items, {
      labelPrefix: "Concurrent Agents",
    });

    expect(groups.value[0].label).toBe("Concurrent Agents A");
  });

  it("returns empty labels when generateLabels is false", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
    ]);
    const { groups, idToLabel } = useParallelAgentDetection(items, {
      generateLabels: false,
    });

    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].label).toBe("");
    expect(groups.value[0].ids).toHaveLength(2);

    // idToLabel should map to empty strings
    expect(idToLabel.value.get("a1")).toBe("");
    expect(idToLabel.value.get("a2")).toBe("");
  });

  it("generates sequential labels (A, B, C...)", () => {
    const items = ref<TimeRangedItem[]>([
      // Group A
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:03:00Z", completedAt: "2024-01-01T10:07:00Z" },
      // Group B
      { id: "a3", startedAt: "2024-01-01T10:10:00Z", completedAt: "2024-01-01T10:15:00Z" },
      { id: "a4", startedAt: "2024-01-01T10:12:00Z", completedAt: "2024-01-01T10:17:00Z" },
      // Group C
      { id: "a5", startedAt: "2024-01-01T10:20:00Z", completedAt: "2024-01-01T10:25:00Z" },
      { id: "a6", startedAt: "2024-01-01T10:22:00Z", completedAt: "2024-01-01T10:27:00Z" },
    ]);
    const { groups } = useParallelAgentDetection(items);

    expect(groups.value).toHaveLength(3);

    const labels = groups.value.map((g) => g.label).sort();
    expect(labels).toEqual(["Parallel Group A", "Parallel Group B", "Parallel Group C"]);
  });

  it("handles edge case: exact same start and end times", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    // Exact same time range → overlap
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(2);
    expect(parallelIds.value.size).toBe(2);
  });

  it("handles edge case: one item starts exactly when another ends", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
      { id: "a2", startedAt: "2024-01-01T10:05:00Z", completedAt: "2024-01-01T10:10:00Z" },
    ]);
    const { groups } = useParallelAgentDetection(items);

    // a1.start (10:00) < a2.end (10:10) ✓
    // a2.start (10:05) < a1.end (10:05) ✗ (not strictly less)
    // → No overlap (boundary case: touching but not overlapping)
    expect(groups.value).toEqual([]);
  });

  it("reactively updates when items change", () => {
    const items = ref<TimeRangedItem[]>([
      { id: "a1", startedAt: "2024-01-01T10:00:00Z", completedAt: "2024-01-01T10:05:00Z" },
    ]);
    const { groups, parallelIds } = useParallelAgentDetection(items);

    expect(groups.value).toEqual([]);
    expect(parallelIds.value.size).toBe(0);

    // Add an overlapping item
    items.value.push({
      id: "a2",
      startedAt: "2024-01-01T10:03:00Z",
      completedAt: "2024-01-01T10:07:00Z",
    });

    // Should reactively detect the new parallel group
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0].ids).toHaveLength(2);
    expect(parallelIds.value.size).toBe(2);
  });
});
