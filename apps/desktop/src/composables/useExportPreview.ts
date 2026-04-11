/**
 * Composable for fetching a debounced live preview of an export.
 * Watches sessionId, format, sections, contentDetail, and redaction — re-fetches on any change.
 */

import { previewExport } from "@tracepilot/client";
import type {
  ContentDetailOptions,
  ExportFormat,
  ExportPreviewResult,
  RedactionOptions,
  SectionId,
} from "@tracepilot/types";
import { toErrorMessage, useAsyncGuard } from "@tracepilot/ui";
import { type ComputedRef, onUnmounted, type Ref, ref, watch } from "vue";
import { logError } from "@/utils/logger";

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
  const guard = useAsyncGuard();

  function clearPreviewState() {
    guard.invalidate();
    loading.value = false;
    preview.value = null;
    error.value = null;
  }

  async function fetchPreview() {
    const sid = sessionId.value;
    if (!sid) {
      clearPreviewState();
      return;
    }

    const token = guard.start();
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
      if (!guard.isValid(token)) return;

      preview.value = result;
    } catch (err) {
      if (!guard.isValid(token)) return;
      logError("[export] Preview failed:", err);
      error.value = toErrorMessage(err);
      preview.value = null;
    } finally {
      if (guard.isValid(token)) {
        loading.value = false;
      }
    }
  }

  function scheduleFetch() {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (!sessionId.value) {
      clearPreviewState();
      return;
    }
    debounceTimer = setTimeout(fetchPreview, DEBOUNCE_MS);
  }

  const watchSources: Array<Ref | ComputedRef> = [sessionId, format, sections];
  if (contentDetail) watchSources.push(contentDetail);
  if (redaction) watchSources.push(redaction);
  watch(watchSources, scheduleFetch, { deep: true });

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    guard.invalidate();
  });

  return { preview, loading, error, refresh: fetchPreview };
}