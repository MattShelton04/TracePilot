/**
 * useSessionDetailContext — resolves the correct session detail instance.
 *
 * In tab mode (SessionDetailTabView), returns the injected per-tab instance.
 * In route mode (SessionDetailView), returns the Pinia singleton store.
 *
 * Both paths return an auto-unwrapped reactive interface (no .value needed).
 */

import { inject } from "vue";
import type { SessionDetailContext } from "@/composables/useSessionDetail";
import { SESSION_DETAIL_KEY } from "@/composables/useSessionDetail";
import { useSessionDetailStore } from "@/stores/sessionDetail";

export function useSessionDetailContext(): SessionDetailContext {
  // Try inject first (tab mode provides a reactive-wrapped instance)
  const injected = inject(SESSION_DETAIL_KEY, null);
  if (injected) return injected;

  // Fallback to Pinia singleton (route mode) — Pinia also auto-unwraps refs
  return useSessionDetailStore() as unknown as SessionDetailContext;
}
