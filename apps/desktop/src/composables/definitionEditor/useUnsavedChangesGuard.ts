import { useConfirmDialog } from "@tracepilot/ui";
import {
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
  type RouteLocationNormalizedGeneric,
} from "vue-router";

interface UnsavedChangesGuardOptions {
  /** Whether leaving now would discard edits. */
  isDirty: () => boolean;
  title: string;
  message: string;
  /** Route updates that keep the same document (e.g. query changes) pass. */
  isSameDocument: (
    to: RouteLocationNormalizedGeneric,
    from: RouteLocationNormalizedGeneric,
  ) => boolean;
}

/**
 * Confirm before any navigation (sidebar, history, in-page links) would
 * discard unsaved edits, not only the editor's own Back button. Rapid
 * navigation shares one pending decision instead of stacking dialogs.
 */
export function useUnsavedChangesGuard(options: UnsavedChangesGuardOptions) {
  const { confirm } = useConfirmDialog();
  let pending: Promise<boolean> | null = null;

  function confirmNavigation(): boolean | Promise<boolean> {
    if (!options.isDirty()) return true;
    if (!pending) {
      pending = confirm({
        title: options.title,
        message: options.message,
        variant: "warning",
        confirmLabel: "Discard and Leave",
        cancelLabel: "Keep Editing",
      })
        .then(({ confirmed }) => confirmed)
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }

  onBeforeRouteLeave(confirmNavigation);
  onBeforeRouteUpdate((to, from) =>
    options.isSameDocument(to, from) ? true : confirmNavigation(),
  );

  return { confirmNavigation };
}
