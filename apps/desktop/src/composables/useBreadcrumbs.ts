import { type ComputedRef, computed } from "vue";
import { useRoute } from "vue-router";
import { useSessionsStore } from "@/stores/sessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";

export interface Breadcrumb {
  label: string;
  to?: string;
}

/**
 * Derives breadcrumb trail for the top-of-page header.
 *
 * Extracted from `App.vue` (Phase 4.5 / Wave 47) so the presentation shell
 * stays focused on layout + lifecycle.  The output — including labels,
 * ordering, and `to` paths — is preserved byte-for-byte from the original
 * inline computed.
 *
 * @param isTabViewActive Reactive flag indicating the session tab view is
 *   currently covering the router-view (shared App-level state).
 */
export function useBreadcrumbs(isTabViewActive: ComputedRef<boolean>): {
  breadcrumbs: ComputedRef<Breadcrumb[]>;
} {
  const route = useRoute();
  const sessionsStore = useSessionsStore();
  const tabStore = useSessionTabsStore();

  const breadcrumbs = computed<Breadcrumb[]>(() => {
    const crumbs: Breadcrumb[] = [{ label: "Sessions", to: "/" }];

    // Tab mode: breadcrumbs reflect the active tab
    if (isTabViewActive.value) {
      // biome-ignore lint/style/noNonNullAssertion: isTabViewActive is true implies tabStore.activeTab is set.
      const tab = tabStore.activeTab!;
      crumbs.push({ label: tab.label });
      return crumbs;
    }

    if (route.name === "sessions" || route.name === "not-found") {
      return [{ label: "Sessions" }];
    }

    // Session detail pages (legacy route mode)
    if (route.params.id) {
      const detail = sessionsStore.sessions.find((s) => s.id === route.params.id);
      const sessionLabel =
        detail?.summary?.slice(0, 40) || `Session ${String(route.params.id).slice(0, 8)}`;
      crumbs.push({ label: sessionLabel, to: `/session/${route.params.id}/overview` });

      if (route.meta?.title && route.meta.title !== "Session Detail") {
        crumbs.push({ label: route.meta.title as string });
      }
      return crumbs;
    }

    // Top-level pages
    if (route.meta?.title) {
      return [{ label: route.meta.title as string }];
    }

    return crumbs;
  });

  return { breadcrumbs };
}
