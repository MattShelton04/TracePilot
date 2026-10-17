import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, reactive } from "vue";
import { useBreadcrumbs } from "@/composables/useBreadcrumbs";
import { useSessionsStore } from "@/stores/sessions";

const route = reactive({
  name: "session-overview" as string,
  params: { id: "c1a0de00-0000-4000-8000-000000000005" } as Record<string, string>,
  meta: { title: "Overview" } as Record<string, unknown>,
});
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRoute: () => route,
}));

const LONG_TITLE =
  "Resume the cost dashboard work and estimate cost with live pricing for every model";

describe("useBreadcrumbs", () => {
  beforeEach(() => setupPinia());

  it("passes the whole session title so the breadcrumb can show it on hover", () => {
    useSessionsStore().sessions = [
      { id: route.params.id, summary: LONG_TITLE } as unknown as SessionListItem,
    ];
    const { breadcrumbs } = useBreadcrumbs(computed(() => false));
    expect(breadcrumbs.value).toEqual([
      { label: "Sessions", to: "/" },
      { label: LONG_TITLE, to: `/session/${route.params.id}/overview` },
      { label: "Overview" },
    ]);
  });

  it("falls back to the short id when the session has no title", () => {
    useSessionsStore().sessions = [];
    const { breadcrumbs } = useBreadcrumbs(computed(() => false));
    expect(breadcrumbs.value[1].label).toBe("Session c1a0de00");
  });
});
