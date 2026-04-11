import { createPinia, setActivePinia } from "pinia";

/**
 * Activates a fresh Pinia instance for the current test scope.
 * Call in `beforeEach` to isolate stores between tests.
 *
 * @example
 * ```ts
 * import { setupPinia } from "@tracepilot/test-utils";
 * beforeEach(() => { setupPinia(); });
 * ```
 */
export function setupPinia(): void {
  setActivePinia(createPinia());
}
