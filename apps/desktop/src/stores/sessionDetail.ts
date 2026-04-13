/**
 * sessionDetail Pinia store — thin wrapper around the composable.
 *
 * This store delegates ALL logic to `createSessionDetailInstance()` from
 * `@/composables/useSessionDetail`. It exists solely to maintain backward
 * compatibility for components that still import `useSessionDetailStore()`.
 *
 * New multi-tab code should use `injectSessionDetail()` instead.
 */
import { defineStore } from "pinia";
import { createSessionDetailInstance } from "@/composables/useSessionDetail";

export { SESSION_DETAIL_KEY, injectSessionDetail, toSessionDetailContext } from "@/composables/useSessionDetail";
export type { SessionDetailInstance, SessionDetailContext } from "@/composables/useSessionDetail";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  return createSessionDetailInstance();
});