import { type TracePilotConfigPatch, updateConfig } from "@tracepilot/client";
import type { TracePilotConfig } from "@tracepilot/types";

type ConfigSection = Exclude<keyof TracePilotConfig, "version">;

function snapshot(config: TracePilotConfig): TracePilotConfig {
  return JSON.parse(JSON.stringify(config));
}

/** Config sections contain scalar fields or atomic collection values. */
function changedFields(before: TracePilotConfig, after: TracePilotConfig): TracePilotConfigPatch {
  const patch: Record<string, Record<string, unknown>> = {};
  for (const section of Object.keys(after) as (keyof TracePilotConfig)[]) {
    if (section === "version") continue;
    const previous = before[section] as unknown as Record<string, unknown>;
    for (const [field, value] of Object.entries(after[section])) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(value)) {
        patch[section] ??= {};
        patch[section][field] = value;
      }
    }
  }
  return patch as TracePilotConfigPatch;
}

function merge(config: TracePilotConfig, patch: TracePilotConfigPatch): TracePilotConfig {
  const merged = snapshot(config);
  for (const section of Object.keys(patch) as ConfigSection[]) {
    Object.assign(merged[section], patch[section]);
  }
  return merged;
}

/** Serializes writes and preserves edits made while a write is pending. */
export function createPreferencePersistence(
  read: () => TracePilotConfig,
  apply: (config: TracePilotConfig) => void,
) {
  let persisted = snapshot(read());
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;

  function accept(config: TracePilotConfig) {
    apply(config);
    // Track normalized UI values so hydration alone does not trigger a write.
    persisted = snapshot(read());
  }

  function save(explicit: TracePilotConfigPatch = {}): Promise<TracePilotConfig> {
    const operation = queue.then(async () => {
      const before = snapshot(read());
      if (disposed) return before;
      const desired = merge(before, explicit);
      const patch = changedFields(persisted, desired);
      if (Object.keys(patch).length === 0) return before;
      const saved = await updateConfig(patch);
      if (disposed) return saved;
      const pendingEdits = changedFields(before, snapshot(read()));
      accept(saved);
      apply(merge(saved, pendingEdits));
      return saved;
    });
    queue = operation.catch(() => {});
    return operation;
  }

  return {
    accept,
    save,
    dispose: () => {
      disposed = true;
    },
  };
}
