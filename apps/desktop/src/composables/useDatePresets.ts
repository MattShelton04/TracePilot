import { ref, type Ref } from 'vue';

export interface DatePreset {
  key: string;
  label: string;
}

export const PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
  { key: '3months', label: 'Last 90 Days' },
  { key: 'all', label: 'All Time' },
];

interface DateRange {
  from: string | null;
  to: string | null;
}

function calculateRange(preset: string): DateRange {
  const today = new Date();
  const formatDate = (d: Date) => d.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { from: formatDate(today), to: formatDate(today) };
    case 'week':
      return { from: formatDate(new Date(Date.now() - 7 * 86400000)), to: null };
    case 'month':
      return { from: formatDate(new Date(Date.now() - 30 * 86400000)), to: null };
    case '3months':
      return { from: formatDate(new Date(Date.now() - 90 * 86400000)), to: null };
    case 'all':
    default:
      return { from: null, to: null };
  }
}

/**
 * Composable for managing date preset selections.
 *
 * This composable helps manage common date range presets (today, week, month, etc.)
 * and synchronizes them with provided date refs.
 *
 * @param dateFrom - Ref to the date from value
 * @param dateTo - Ref to the date to value
 * @returns Object with activePreset ref and functions to set/clear presets
 *
 * @example
 * ```typescript
 * const { activePreset, setPreset, clearPreset } = useDatePresets(
 *   toRef(store, 'dateFrom'),
 *   toRef(store, 'dateTo')
 * );
 *
 * // Set a preset
 * setPreset('week'); // Sets dateFrom to 7 days ago, dateTo to null
 *
 * // Clear dates
 * clearPreset(); // Sets both dates to null, activePreset to 'all'
 * ```
 */
export function useDatePresets(
  dateFrom: Ref<string | null>,
  dateTo: Ref<string | null>
) {
  const activePreset = ref<string>('all');

  /**
   * Set a date preset and update the date refs accordingly
   */
  function setPreset(preset: string) {
    activePreset.value = preset;
    const range = calculateRange(preset);
    dateFrom.value = range.from;
    dateTo.value = range.to;
  }

  /**
   * Clear the date preset and reset dates to null
   */
  function clearPreset() {
    activePreset.value = 'all';
    dateFrom.value = null;
    dateTo.value = null;
  }

  return {
    presets: PRESETS,
    activePreset,
    setPreset,
    clearPreset,
  };
}
