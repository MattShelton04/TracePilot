import { type ComputedRef, computed, type Ref } from "vue";

/**
 * An item with a time range that can be checked for overlap with other items.
 */
export interface TimeRangedItem {
  /** Unique identifier for this item */
  id: string;
  /** ISO timestamp when this item started */
  startedAt: string | null;
  /** ISO timestamp when this item completed (optional) */
  completedAt?: string | null;
  /** Duration in milliseconds (used as fallback if completedAt is missing) */
  durationMs?: number;
}

/**
 * A group of items that overlap in time (execute in parallel).
 */
export interface ParallelGroup {
  /** Human-readable label for this group (e.g., "Parallel Group A") */
  label: string;
  /** IDs of all items in this parallel group */
  ids: string[];
}

/**
 * Options for configuring parallel detection behavior.
 */
export interface UseParallelAgentDetectionOptions {
  /** Whether to auto-generate labels (A, B, C...). Default: true */
  generateLabels?: boolean;
  /** Custom label prefix. Default: "Parallel Group" */
  labelPrefix?: string;
}

/**
 * Return value from useParallelAgentDetection composable.
 */
export interface UseParallelAgentDetectionReturn {
  /** Grouped format with labels (e.g., [{label: "Parallel Group A", ids: ["id1", "id2"]}]) */
  groups: ComputedRef<ParallelGroup[]>;
  /** Flat set of all IDs that are in any parallel group */
  parallelIds: ComputedRef<Set<string>>;
  /** Map from item ID to its parallel group label */
  idToLabel: ComputedRef<Map<string, string>>;
}

/**
 * Detects which time-ranged items overlap (execute in parallel) using a Union-Find algorithm.
 *
 * Two items overlap if their time ranges intersect: `a.start < b.end && b.start < a.end`.
 * The algorithm groups all overlapping items together (transitive: if A overlaps B and B overlaps C,
 * then A, B, and C are all in the same group).
 *
 * **Time Complexity**: O(n²) where n is the number of items with valid timestamps.
 * - The nested loop to detect overlaps is O(n²)
 * - Union-Find operations are nearly O(1) with path compression (O(α(n)) where α is inverse Ackermann)
 * - Note: O(n²) is optimal for this problem as all pairs must be checked for overlap
 *
 * @param items - Array of items with time ranges (reactive ref or computed)
 * @param options - Configuration options for labeling and behavior
 * @returns Three different views of the parallel groups (grouped, flat set, and label map)
 *
 * @example
 * ```typescript
 * const agents = ref([
 *   { id: 'a1', startedAt: '2024-01-01T10:00:00Z', completedAt: '2024-01-01T10:05:00Z' },
 *   { id: 'a2', startedAt: '2024-01-01T10:03:00Z', completedAt: '2024-01-01T10:07:00Z' },
 *   { id: 'a3', startedAt: '2024-01-01T10:10:00Z', completedAt: '2024-01-01T10:15:00Z' },
 * ]);
 *
 * const { groups, parallelIds, idToLabel } = useParallelAgentDetection(agents);
 * // groups.value = [{ label: "Parallel Group A", ids: ["a1", "a2"] }]
 * // parallelIds.value = Set(["a1", "a2"])
 * // idToLabel.value = Map([["a1", "Parallel Group A"], ["a2", "Parallel Group A"]])
 * ```
 */
export function useParallelAgentDetection<T extends TimeRangedItem>(
  items: Ref<T[]> | ComputedRef<T[]>,
  options: UseParallelAgentDetectionOptions = {},
): UseParallelAgentDetectionReturn {
  const { generateLabels = true, labelPrefix = "Parallel Group" } = options;

  /**
   * Internal representation of a timed item with parsed timestamps.
   */
  interface TimedItem {
    id: string;
    start: number;
    end: number;
  }

  /**
   * Parse items and filter out those with invalid or missing timestamps.
   */
  const timedItems = computed<TimedItem[]>(() => {
    const result: TimedItem[] = [];

    for (const item of items.value) {
      // Skip items without a start time
      if (!item.startedAt) continue;

      const start = new Date(item.startedAt).getTime();
      if (Number.isNaN(start)) continue;

      // Compute end time (use completedAt if available, otherwise startedAt + durationMs)
      let end: number;
      if (item.completedAt) {
        end = new Date(item.completedAt).getTime();
        if (Number.isNaN(end)) continue;
      } else if (item.durationMs !== undefined && item.durationMs !== null) {
        end = start + item.durationMs;
      } else {
        // No end time available, treat as instant (start === end)
        end = start;
      }

      result.push({ id: item.id, start, end });
    }

    return result;
  });

  /**
   * Detect parallel groups using Union-Find algorithm.
   */
  const groups = computed<ParallelGroup[]>(() => {
    const timed = timedItems.value;
    if (timed.length < 2) return [];

    // Union-Find data structure
    const parent = new Map<string, string>();

    /**
     * Find the root representative of a set (with path compression).
     */
    function find(id: string): string {
      if (!parent.has(id)) {
        parent.set(id, id);
        return id;
      }
      const p = parent.get(id)!;
      if (p !== id) {
        // Path compression: set parent directly to root
        parent.set(id, find(p));
      }
      return parent.get(id)!;
    }

    /**
     * Union two sets by making their roots point to the same representative.
     */
    function union(a: string, b: string): void {
      const rootA = find(a);
      const rootB = find(b);
      if (rootA !== rootB) {
        parent.set(rootA, rootB);
      }
    }

    // Find all overlapping pairs and union them
    for (let i = 0; i < timed.length; i++) {
      for (let j = i + 1; j < timed.length; j++) {
        const a = timed[i];
        const b = timed[j];
        // Check for overlap: a.start < b.end && b.start < a.end
        if (a.start < b.end && b.start < a.end) {
          union(a.id, b.id);
        }
      }
    }

    // Collect all items by their root representative
    const groupMap = new Map<string, string[]>();
    for (const item of timed) {
      const root = find(item.id);
      if (!groupMap.has(root)) {
        groupMap.set(root, []);
      }
      groupMap.get(root)!.push(item.id);
    }

    // Build parallel groups (only groups with 2+ items)
    const result: ParallelGroup[] = [];
    let labelIndex = 0;

    for (const [, ids] of groupMap) {
      if (ids.length > 1) {
        const label = generateLabels
          ? `${labelPrefix} ${String.fromCharCode(65 + labelIndex)}`
          : "";
        labelIndex++;
        result.push({ label, ids });
      }
    }

    return result;
  });

  /**
   * Flat set of all item IDs that are in any parallel group.
   */
  const parallelIds = computed<Set<string>>(() => {
    const result = new Set<string>();
    for (const group of groups.value) {
      for (const id of group.ids) {
        result.add(id);
      }
    }
    return result;
  });

  /**
   * Map from item ID to its parallel group label.
   */
  const idToLabel = computed<Map<string, string>>(() => {
    const result = new Map<string, string>();
    for (const group of groups.value) {
      for (const id of group.ids) {
        result.set(id, group.label);
      }
    }
    return result;
  });

  return {
    groups,
    parallelIds,
    idToLabel,
  };
}
