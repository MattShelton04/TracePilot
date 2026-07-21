import { sessionSearchFiles } from "@tracepilot/client";
import type { SessionFileSearchResponse } from "@tracepilot/types";
import { onScopeDispose, ref, watch } from "vue";

interface ExplorerContentSearchOptions {
  debounceMs?: number;
  search?: (sessionId: string, query: string) => Promise<SessionFileSearchResponse>;
}

function sameResponse(
  current: SessionFileSearchResponse | null,
  next: SessionFileSearchResponse,
): boolean {
  if (!current) return false;
  if (
    current.scannedFiles !== next.scannedFiles ||
    current.skippedFiles !== next.skippedFiles ||
    current.truncated !== next.truncated ||
    current.matches.length !== next.matches.length
  ) {
    return false;
  }
  return current.matches.every((match, index) => {
    const other = next.matches[index];
    return (
      match.path === other.path &&
      match.lineNumber === other.lineNumber &&
      match.excerpt === other.excerpt
    );
  });
}

/**
 * Owns the Session Explorer content-query lifecycle: debounce, stale-response
 * cancellation, background refresh, and stable result identity.
 */
export function useExplorerContentSearch(
  getSessionId: () => string | null | undefined,
  options: ExplorerContentSearchOptions = {},
) {
  const searchMode = ref<"name" | "content">("name");
  const searchQuery = ref("");
  const contentSearch = ref<SessionFileSearchResponse | null>(null);
  const contentSearchLoading = ref(false);
  const contentSearchError = ref<string | null>(null);
  const debounceMs = options.debounceMs ?? 300;
  const search = options.search ?? sessionSearchFiles;
  let requestSequence = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runContentSearch(runOptions: { background?: boolean } = {}) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const sessionId = getSessionId();
    const query = searchQuery.value.trim();
    if (searchMode.value !== "content" || !sessionId || query.length < 2) {
      contentSearch.value = null;
      contentSearchError.value = null;
      contentSearchLoading.value = false;
      return;
    }

    const sequence = ++requestSequence;
    if (!runOptions.background || !contentSearch.value) contentSearchLoading.value = true;
    contentSearchError.value = null;
    try {
      const result = await search(sessionId, query);
      if (sequence !== requestSequence) return;
      if (!sameResponse(contentSearch.value, result)) contentSearch.value = result;
    } catch (error) {
      if (sequence !== requestSequence) return;
      contentSearchError.value = error instanceof Error ? error.message : String(error);
      contentSearch.value = null;
    } finally {
      if (sequence === requestSequence) contentSearchLoading.value = false;
    }
  }

  watch([searchQuery, searchMode], () => {
    requestSequence += 1;
    if (timer) clearTimeout(timer);
    if (searchMode.value !== "content" || searchQuery.value.trim().length < 2) {
      contentSearch.value = null;
      contentSearchError.value = null;
      contentSearchLoading.value = false;
      return;
    }
    contentSearch.value = null;
    contentSearchError.value = null;
    contentSearchLoading.value = false;
    timer = setTimeout(() => {
      timer = null;
      void runContentSearch();
    }, debounceMs);
  });

  onScopeDispose(() => {
    requestSequence += 1;
    if (timer) clearTimeout(timer);
  });

  return {
    searchMode,
    searchQuery,
    contentSearch,
    contentSearchLoading,
    contentSearchError,
    runContentSearch,
  };
}
