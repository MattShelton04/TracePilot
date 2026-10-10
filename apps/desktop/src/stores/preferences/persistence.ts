import { factoryReset, type TracePilotConfigPatch, updateConfig } from "@tracepilot/client";
import type { TracePilotConfig } from "@tracepilot/types";
import { logWarn } from "@/utils/logger";

type ConfigSection = Exclude<keyof TracePilotConfig, "version">;

function snapshot(config: TracePilotConfig): TracePilotConfig {
  return JSON.parse(JSON.stringify(config));
}

type Fields = Record<string, unknown>;

/**
 * Fields that are themselves sections, patched field by field one level
 * deeper (the backend's `SourcesPatch`). Every other value, including records
 * such as `toolRendering.toolOverrides`, is atomic and replaces as a whole.
 */
const NESTED_SECTIONS: Partial<Record<ConfigSection, readonly string[]>> = {
  sources: ["claudeCode"],
};

function isNested(section: ConfigSection, field: string): boolean {
  return NESTED_SECTIONS[section]?.includes(field) ?? false;
}

function diffFields(before: Fields | undefined, after: Fields): Fields {
  const patch: Fields = {};
  for (const [field, value] of Object.entries(after)) {
    if (JSON.stringify(before?.[field]) !== JSON.stringify(value)) patch[field] = value;
  }
  return patch;
}

/** Config sections contain scalar fields, atomic collections, or nested sections. */
function changedFields(before: TracePilotConfig, after: TracePilotConfig): TracePilotConfigPatch {
  const patch: Record<string, Fields> = {};
  for (const section of Object.keys(after) as (keyof TracePilotConfig)[]) {
    if (section === "version") continue;
    const previous = before[section] as unknown as Fields;
    const changed = diffFields(previous, after[section] as unknown as Fields);
    for (const [field, value] of Object.entries(changed)) {
      const nested =
        isNested(section, field) && value
          ? diffFields(previous[field] as Fields | undefined, value as Fields)
          : value;
      patch[section] ??= {};
      patch[section][field] = nested;
    }
  }
  return patch as TracePilotConfigPatch;
}

function merge(config: TracePilotConfig, patch: TracePilotConfigPatch): TracePilotConfig {
  const merged = snapshot(config);
  for (const section of Object.keys(patch) as ConfigSection[]) {
    const target = merged[section] as unknown as Fields;
    for (const [field, value] of Object.entries(patch[section] ?? {})) {
      // A nested section keeps its other fields, as the backend does.
      target[field] =
        isNested(section, field) && value ? { ...(target[field] as Fields), ...value } : value;
    }
  }
  return merged;
}

/** Owns autosave, ordered writes, and the reset boundary around pending work. */
export function createPreferencePersistence(
  read: () => TracePilotConfig,
  apply: (config: TracePilotConfig) => void,
  isHydrated: () => boolean,
) {
  let persisted = snapshot(read());
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let resetting = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function accept(config: TracePilotConfig) {
    apply(config);
    // Track normalized UI values so hydration alone does not trigger a write.
    persisted = snapshot(read());
  }

  function save(explicit: TracePilotConfigPatch = {}): Promise<TracePilotConfig> {
    if (resetting) {
      return Promise.reject(new Error("Preferences cannot be changed during factory reset."));
    }
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

  function cancelScheduledSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
  }

  function scheduleSave() {
    if (!isHydrated() || resetting || disposed) return;
    cancelScheduledSave();
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        await save();
      } catch (error) {
        logWarn("[preferences] Failed to persist config:", error);
      }
    }, 300);
  }

  async function resetConfig(hydrationWork: Promise<void> | null) {
    if (resetting) throw new Error("Factory reset is already in progress.");
    // Close the write boundary before yielding. Already accepted writes drain;
    // new settings actions and debounce callbacks cannot run behind the reset.
    resetting = true;
    cancelScheduledSave();
    try {
      // Hydration may still be saving a legacy full configuration.
      await hydrationWork;
      await queue;
      await factoryReset();
      // Stay suspended until the caller reloads into first-run setup.
    } catch (error) {
      resetting = false;
      scheduleSave();
      throw error;
    }
  }

  return {
    accept,
    save,
    scheduleSave,
    resetConfig,
    isResetting: () => resetting,
    dispose: () => {
      disposed = true;
      cancelScheduledSave();
    },
  };
}
