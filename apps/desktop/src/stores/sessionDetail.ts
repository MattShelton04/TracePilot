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

export type { SessionDetailContext, SessionDetailInstance } from "@/composables/useSessionDetail";
export {
  injectSessionDetail,
  SESSION_DETAIL_KEY,
  toSessionDetailContext,
} from "@/composables/useSessionDetail";

export const useSessionDetailStore = defineStore("sessionDetail", () => {
  return createSessionDetailInstance();
});
