/**
 * Shared content-type display config for search views.
 *
 * Maps each SearchContentType to its human-readable label and accent color.
 * Used by SearchPalette and SessionSearchView to render content-type badges,
 * filter chips, and grouped result headings.
 */

import type { SearchContentType } from '@tracepilot/types';

/** Visual style for a search content type (label + color). */
export interface ContentTypeStyle {
  label: string;
  color: string;
}

/**
 * Display config for every SearchContentType.
 *
 * Typed as `Record<SearchContentType, …>` so that adding a new variant
 * to the union will cause a compile error until this map is updated.
 */
export const CONTENT_TYPE_CONFIG: Record<SearchContentType, ContentTypeStyle> = {
  user_message: { label: 'User Message', color: '#4ade80' },
  assistant_message: { label: 'Assistant Message', color: '#60a5fa' },
  reasoning: { label: 'Reasoning', color: '#a78bfa' },
  tool_call: { label: 'Tool Call', color: '#f59e0b' },
  tool_result: { label: 'Tool Result', color: '#fb923c' },
  tool_error: { label: 'Tool Error', color: '#ef4444' },
  error: { label: 'Error', color: '#ef4444' },
  compaction_summary: { label: 'Compaction', color: '#818cf8' },
  system_message: { label: 'System Message', color: '#94a3b8' },
  subagent: { label: 'Subagent', color: '#c084fc' },
  checkpoint: { label: 'Checkpoint', color: '#06b6d4' },
};

/**
 * All content types as an ordered array — derived from the config map.
 * The cast is safe because the Record type guarantees all keys are present.
 */
export const ALL_CONTENT_TYPES = Object.keys(CONTENT_TYPE_CONFIG) as SearchContentType[];
