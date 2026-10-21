/**
 * Composable managing export configuration state: session selection,
 * format, section toggles, and preset application.
 */

import type {
  ContentDetailOptions,
  ExportFormat,
  RedactionOptions,
  SectionId,
  SourceCapabilities,
} from "@tracepilot/types";
import { ALL_SECTION_IDS } from "@tracepilot/types";
import { usePersistedRef } from "@tracepilot/ui";
import { computed, ref, watch } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";

/**
 * UI-level format selection — superset of the backend `ExportFormat` that adds
 * `"zip"` for the "raw session folder zip" path. The zip option is dispatched
 * to a separate Tauri command (`export_session_folder_zip`) rather than the
 * regular renderer pipeline.
 */
export type ExportTabFormat = ExportFormat | "zip";

// ── Preset Definitions ──────────────────────────────────────────

export interface ExportPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  format: ExportFormat;
  sections: SectionId[];
  /** Optional content-detail overrides applied when this preset is activated. */
  contentDetail?: Partial<ContentDetailOptions>;
  /** Optional redaction overrides applied when this preset is activated. */
  redaction?: Partial<RedactionOptions>;
}

/**
 * A built-in preset sets every content-detail option, so it exports the same
 * content whichever preset was used before it.
 */
export interface BuiltInExportPreset extends ExportPreset {
  contentDetail: ContentDetailOptions;
}

/** The content-detail options of a fresh install and of Full Archive. */
const DEFAULT_CONTENT_DETAIL: Readonly<ContentDetailOptions> = {
  includeSubagentInternals: true,
  includeToolDetails: true,
  includeFullToolResults: false,
};

/** The redaction options of a fresh install: nothing is redacted. */
const NO_REDACTION: Readonly<RedactionOptions> = {
  anonymizePaths: false,
  stripSecrets: false,
  stripPii: false,
};

export const EXPORT_PRESETS: readonly BuiltInExportPreset[] = [
  {
    id: "full",
    label: "Full Archive",
    icon: "📦",
    description: "Lossless archive — all data, suitable for re-import.",
    format: "json",
    sections: [...ALL_SECTION_IDS],
    contentDetail: { ...DEFAULT_CONTENT_DETAIL },
  },
  {
    id: "minimal-team-log",
    label: "Minimal Team Log",
    icon: "📝",
    description:
      "Conversation, plan and todos only — no raw tool arguments or subagent details. Ideal for sharing progress with teammates.",
    format: "markdown",
    sections: ["conversation", "plan", "todos"],
    contentDetail: {
      includeToolDetails: false,
      includeFullToolResults: false,
      includeSubagentInternals: false,
    },
    redaction: { anonymizePaths: false, stripSecrets: false, stripPii: false },
  },
  {
    id: "agent-context",
    label: "Agent Context",
    icon: "🤖",
    description:
      "Session summary for sharing with another AI — includes conversation, plan, todos, and metrics.",
    format: "markdown",
    sections: ["conversation", "todos", "plan", "metrics"],
    contentDetail: { ...DEFAULT_CONTENT_DETAIL },
  },
  {
    id: "full-fidelity-backup",
    label: "Full-Fidelity Backup",
    icon: "🗄️",
    description:
      "Everything — all sections, full tool results, complete subagent conversation trees. The most complete record of a session.",
    format: "markdown",
    sections: [
      "conversation",
      "plan",
      "todos",
      "checkpoints",
      "rewind_snapshots",
      "metrics",
      "incidents",
      "events",
      "parse_diagnostics",
    ],
    contentDetail: {
      includeToolDetails: true,
      includeFullToolResults: true,
      includeSubagentInternals: true,
    },
    redaction: { anonymizePaths: false, stripSecrets: false, stripPii: false },
  },
] as const;

// ── Section Grouping for Display ────────────────────────────────

export interface SectionGroup {
  label: string;
  sections: SectionId[];
}

export const SECTION_GROUPS: readonly SectionGroup[] = [
  { label: "Content", sections: ["conversation", "plan", "todos", "checkpoints"] },
  { label: "Analytics", sections: ["metrics", "incidents"] },
  {
    label: "Technical",
    sections: ["events", "rewind_snapshots", "custom_tables", "parse_diagnostics"],
  },
] as const;

/** Sections only some sources can supply, keyed to the capability that gates each. */
const SECTION_CAPABILITIES: Partial<Record<SectionId, keyof SourceCapabilities>> = {
  plan: "hasPlan",
  todos: "hasTodos",
  checkpoints: "hasCheckpoints",
  rewind_snapshots: "hasRewindSnapshots",
  custom_tables: "hasCustomTables",
};

/** Whether a session whose source has these capabilities can supply the section. */
export function sourceSupportsSection(
  sectionId: SectionId,
  capabilities: SourceCapabilities,
): boolean {
  const flag = SECTION_CAPABILITIES[sectionId];
  return flag ? capabilities[flag] : true;
}

export const SECTION_ICONS: Record<SectionId, string> = {
  conversation: "💬",
  plan: "📋",
  todos: "✅",
  checkpoints: "📌",
  metrics: "📊",
  incidents: "⚠️",
  events: "📡",
  rewind_snapshots: "🔄",
  custom_tables: "📑",
  parse_diagnostics: "🔍",
};

// ── Format Descriptions ─────────────────────────────────────────

export const FORMAT_DESCRIPTIONS: Record<ExportTabFormat, string> = {
  json: "Full fidelity archive — lossless round-trip import/export.",
  markdown: "Human-readable summary — great for sharing in docs or PRs.",
  zip: "Raw zip of the session folder — all files exactly as stored on disk. No rendering or filtering.",
};

// ── Remembered Options ──────────────────────────────────────────

/**
 * The export choices kept across visits and restarts. Per-run choices (the
 * session and the output path) are not kept.
 */
export interface ExportOptions {
  format: ExportTabFormat;
  sections: SectionId[];
  activePreset: string | null;
  contentDetail: ContentDetailOptions;
  redaction: RedactionOptions;
  customPresets: ExportPreset[];
}

export function defaultExportOptions(): ExportOptions {
  return {
    format: "json",
    sections: [...ALL_SECTION_IDS],
    activePreset: "full",
    contentDetail: { ...DEFAULT_CONTENT_DETAIL },
    redaction: { ...NO_REDACTION },
    customPresets: [],
  };
}

const FORMATS: readonly ExportTabFormat[] = ["json", "markdown", "zip"];

function readSections(value: unknown): SectionId[] | null {
  if (!Array.isArray(value)) return null;
  return ALL_SECTION_IDS.filter((id) => value.includes(id));
}

/** Copy each known boolean flag from `value`, keeping the default for the rest. */
function readFlags<T extends object>(value: unknown, defaults: T): T {
  const flags = { ...defaults };
  if (value && typeof value === "object") {
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const flag = (value as Record<keyof T, unknown>)[key];
      if (typeof flag === "boolean") flags[key] = flag as T[keyof T];
    }
  }
  return flags;
}

function readCustomPreset(value: unknown): ExportPreset | null {
  if (!value || typeof value !== "object") return null;
  const { id, label, format, sections, contentDetail, redaction } = value as Record<
    string,
    unknown
  >;
  const presetSections = readSections(sections);
  if (typeof id !== "string" || !id.startsWith("custom-")) return null;
  if (typeof label !== "string" || !label.trim() || !presetSections) return null;
  if (format !== "json" && format !== "markdown") return null;
  const preset = customPreset(id, label, format, presetSections);
  // Presets saved before these options were kept have neither; applying one
  // leaves the current options as they are, as it always did.
  if (contentDetail && typeof contentDetail === "object") {
    preset.contentDetail = readFlags(contentDetail, DEFAULT_CONTENT_DETAIL);
  }
  if (redaction && typeof redaction === "object") {
    preset.redaction = readFlags(redaction, NO_REDACTION);
  }
  return preset;
}

function customPreset(
  id: string,
  label: string,
  format: ExportFormat,
  sections: SectionId[],
  options: Pick<ExportPreset, "contentDetail" | "redaction"> = {},
): ExportPreset {
  return {
    id,
    label,
    icon: "⭐",
    description: `Custom preset: ${label}`,
    format,
    sections,
    ...options,
  };
}

/** Keep each stored choice that is still valid; default the rest. */
export function readExportOptions(raw: string): ExportOptions {
  const stored = JSON.parse(raw) as Record<string, unknown> | null;
  const options = defaultExportOptions();
  options.format = FORMATS.find((f) => f === stored?.format) ?? options.format;
  options.sections = readSections(stored?.sections) ?? options.sections;
  options.contentDetail = readFlags(stored?.contentDetail, options.contentDetail);
  options.redaction = readFlags(stored?.redaction, options.redaction);
  const presets = Array.isArray(stored?.customPresets) ? stored.customPresets : [];
  options.customPresets = presets
    .map(readCustomPreset)
    .filter((preset): preset is ExportPreset => preset !== null);
  const known = [...EXPORT_PRESETS, ...options.customPresets].map((preset) => preset.id);
  const active = stored?.activePreset;
  options.activePreset =
    active === null || (typeof active === "string" && known.includes(active)) ? active : null;
  return options;
}

// ── Composable ──────────────────────────────────────────────────

export function useExportConfig() {
  const stored = usePersistedRef(STORAGE_KEYS.exportOptions, defaultExportOptions(), {
    serializer: { read: readExportOptions, write: (value) => JSON.stringify(value) },
  });
  const initial = stored.value;

  const selectedSessionId = ref("");
  const format = ref<ExportTabFormat>(initial.format);
  const enabledSections = ref(new Set<SectionId>(initial.sections));
  const activePreset = ref<string | null>(initial.activePreset);

  // Content detail options
  const contentDetail = ref<ContentDetailOptions>(initial.contentDetail);

  // Privacy redaction options
  const redaction = ref<RedactionOptions>(initial.redaction);

  // Custom user-saved presets
  const customPresets = ref<ExportPreset[]>(initial.customPresets);

  /** All available presets: built-in + custom */
  const allPresets = computed<ExportPreset[]>(() => [...EXPORT_PRESETS, ...customPresets.value]);

  // Track whether preset is being applied to suppress clearing it
  let applyingPreset = false;

  function applyPreset(presetId: string) {
    const preset = allPresets.value.find((p) => p.id === presetId);
    if (!preset) return;

    applyingPreset = true;
    format.value = preset.format;
    enabledSections.value = new Set(preset.sections);
    activePreset.value = presetId;
    if (preset.contentDetail) {
      contentDetail.value = { ...contentDetail.value, ...preset.contentDetail };
    }
    if (preset.redaction) {
      redaction.value = { ...redaction.value, ...preset.redaction };
    }
    applyingPreset = false;
  }

  function toggleSection(id: SectionId) {
    const next = new Set(enabledSections.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    enabledSections.value = next;
    activePreset.value = null;
  }

  function selectAll() {
    enabledSections.value = new Set(ALL_SECTION_IDS);
    activePreset.value = null;
  }

  function selectNone() {
    enabledSections.value = new Set();
    activePreset.value = null;
  }

  function saveAsPreset(name: string) {
    // "zip" is a transient UI mode (it dispatches to a different Tauri
    // command and has no sections/options) — fall back to "json" when
    // persisting it as a preset so the round-trip stays type-safe.
    const presetFormat: ExportFormat = format.value === "zip" ? "json" : format.value;
    const id = `custom-${Date.now()}`;
    customPresets.value = [
      ...customPresets.value,
      customPreset(id, name, presetFormat, [...enabledSections.value], {
        contentDetail: { ...contentDetail.value },
        redaction: { ...redaction.value },
      }),
    ];
    activePreset.value = id;
  }

  function deleteCustomPreset(presetId: string) {
    customPresets.value = customPresets.value.filter((p) => p.id !== presetId);
    if (activePreset.value === presetId) {
      activePreset.value = null;
    }
  }

  // An option changed by hand no longer matches the preset, as with sections.
  function updateContentDetail(key: keyof ContentDetailOptions, value: boolean) {
    contentDetail.value = { ...contentDetail.value, [key]: value };
    if (!applyingPreset) activePreset.value = null;
  }

  function updateRedaction(key: keyof RedactionOptions, value: boolean) {
    redaction.value = { ...redaction.value, [key]: value };
    if (!applyingPreset) activePreset.value = null;
  }

  // Clear active preset when format changes manually.
  // flush: 'sync' ensures the watcher runs while applyingPreset is still true,
  // so programmatic format changes from applyPreset() don't clear the preset.
  watch(
    format,
    () => {
      if (!applyingPreset) activePreset.value = null;
    },
    { flush: "sync" },
  );

  const sectionsArray = computed<SectionId[]>(() => [...enabledSections.value]);

  // Write every choice back. The refs start from the stored copy, so the
  // format watcher above never sees a restore and keeps the active preset.
  watch([format, sectionsArray, activePreset, contentDetail, redaction, customPresets], () => {
    stored.value = {
      format: format.value,
      sections: sectionsArray.value,
      activePreset: activePreset.value,
      contentDetail: contentDetail.value,
      redaction: redaction.value,
      customPresets: customPresets.value,
    };
  });

  return {
    selectedSessionId,
    format,
    enabledSections,
    activePreset,
    sectionsArray,
    allPresets,
    customPresets,
    contentDetail,
    redaction,
    applyPreset,
    toggleSection,
    selectAll,
    selectNone,
    saveAsPreset,
    deleteCustomPreset,
    updateContentDetail,
    updateRedaction,
  };
}
