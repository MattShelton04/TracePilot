/**
 * Composable managing export configuration state: session selection,
 * format, section toggles, and preset application.
 */

import { ref, computed, watch } from 'vue';
import type { SectionId, ExportFormat } from '@tracepilot/types';
import { ALL_SECTION_IDS, SECTION_LABELS } from '@tracepilot/types';

// ── Preset Definitions ──────────────────────────────────────────

export interface ExportPreset {
  id: string;
  label: string;
  icon: string;
  description: string;
  format: ExportFormat;
  sections: SectionId[];
}

export const EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    id: 'full',
    label: 'Full Archive',
    icon: '📦',
    description: 'Lossless archive — all data, suitable for re-import.',
    format: 'json',
    sections: [...ALL_SECTION_IDS],
  },
  {
    id: 'team',
    label: 'Team Report',
    icon: '👥',
    description: 'Human-readable summary for sharing with teammates.',
    format: 'markdown',
    sections: ['conversation', 'todos', 'plan', 'checkpoints', 'metrics', 'health'],
  },
  {
    id: 'summary',
    label: 'Summary',
    icon: '📋',
    description: 'Brief overview — todos, plan, checkpoints, and metrics.',
    format: 'markdown',
    sections: ['todos', 'plan', 'checkpoints', 'metrics'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: '📊',
    description: 'Tabular metrics and events for spreadsheet analysis.',
    format: 'csv',
    sections: ['metrics', 'events', 'health', 'incidents'],
  },
] as const;

// ── Section Grouping for Display ────────────────────────────────

export interface SectionGroup {
  label: string;
  sections: SectionId[];
}

export const SECTION_GROUPS: readonly SectionGroup[] = [
  { label: 'Content', sections: ['conversation', 'plan', 'todos', 'checkpoints'] },
  { label: 'Analytics', sections: ['metrics', 'health', 'incidents'] },
  { label: 'Technical', sections: ['events', 'rewind_snapshots', 'custom_tables', 'parse_diagnostics'] },
] as const;

export const SECTION_ICONS: Record<SectionId, string> = {
  conversation: '💬',
  plan: '📋',
  todos: '✅',
  checkpoints: '📌',
  metrics: '📊',
  health: '💚',
  incidents: '⚠️',
  events: '📡',
  rewind_snapshots: '🔄',
  custom_tables: '📑',
  parse_diagnostics: '🔍',
};

// ── Format Descriptions ─────────────────────────────────────────

export const FORMAT_DESCRIPTIONS: Record<ExportFormat, string> = {
  json: 'Full fidelity archive — lossless round-trip import/export.',
  markdown: 'Human-readable summary — great for sharing in docs or PRs.',
  csv: 'Tabular data — ideal for spreadsheets and data analysis.',
};

// ── Composable ──────────────────────────────────────────────────

export function useExportConfig() {
  const selectedSessionId = ref('');
  const format = ref<ExportFormat>('json');
  const enabledSections = ref(new Set<SectionId>([...ALL_SECTION_IDS]));
  const activePreset = ref<string | null>('full');

  // Track whether preset is being applied to suppress clearing it
  let applyingPreset = false;

  function applyPreset(presetId: string) {
    const preset = EXPORT_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    applyingPreset = true;
    format.value = preset.format;
    enabledSections.value = new Set(preset.sections);
    activePreset.value = presetId;
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

  // Clear active preset when format changes manually
  watch(format, () => {
    if (!applyingPreset) activePreset.value = null;
  });

  const sectionsArray = computed<SectionId[]>(() => [...enabledSections.value]);

  return {
    selectedSessionId,
    format,
    enabledSections,
    activePreset,
    sectionsArray,
    applyPreset,
    toggleSection,
    selectAll,
    selectNone,
  };
}
