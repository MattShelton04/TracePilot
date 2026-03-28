/**
 * Composable for fetching a debounced live preview of an export.
 * Watches sessionId, format, sections, contentDetail, and redaction — re-fetches on any change.
 */

import { ref, watch, onUnmounted, type Ref, type ComputedRef } from 'vue';
import type { ExportFormat, SectionId, ExportPreviewResult, ContentDetailOptions, RedactionOptions } from '@tracepilot/types';
import { previewExport } from '@tracepilot/client';
import { logError } from '@/utils/logger';

const DEBOUNCE_MS = 400;

export function useExportPreview(
  sessionId: Ref<string>,
  format: Ref<ExportFormat>,
  sections: Ref<SectionId[]> | ComputedRef<SectionId[]>,
  contentDetail?: Ref<ContentDetailOptions>,
  redaction?: Ref<RedactionOptions>,
) {
  const preview = ref<ExportPreviewResult | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestId = 0;

  async function fetchPreview() {
    const sid = sessionId.value;
    if (!sid) {
      preview.value = null;
      error.value = null;
      return;
    }

    const thisRequest = ++requestId;
    loading.value = true;
    error.value = null;

    try {
      const result = await previewExport({
        sessionId: sid,
        format: format.value,
        sections: sections.value,
        contentDetail: contentDetail?.value,
        redaction: redaction?.value,
      });

      // Guard against stale responses
      if (thisRequest !== requestId) return;

      preview.value = result;
    } catch (err) {
      if (thisRequest !== requestId) return;
      logError('[export] Preview failed:', err);
      error.value = err instanceof Error ? err.message : String(err);
      preview.value = null;
    } finally {
      if (thisRequest === requestId) {
        loading.value = false;
      }
    }
  }

  function scheduleFetch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, DEBOUNCE_MS);
  }

  const watchSources: Array<Ref | ComputedRef> = [sessionId, format, sections];
  if (contentDetail) watchSources.push(contentDetail);
  if (redaction) watchSources.push(redaction);
  watch(watchSources, scheduleFetch, { deep: true });

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    requestId++; // Invalidate any in-flight request
  });

  return { preview, loading, error, refresh: fetchPreview };
}
