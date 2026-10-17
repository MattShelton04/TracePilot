import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem, SessionSource } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAnalyticsStore } from "@/stores/analytics";
import { usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";
import AnalyticsPageHeader from "../AnalyticsPageHeader.vue";

const copilot: SessionListItem = {
  id: "copilot-session",
  repository: "demo/app",
  eventCount: 1,
  turnCount: 1,
  isRunning: false,
};
const claude: SessionListItem = { ...copilot, id: "claude-session", source: "claudeCode" };

function render() {
  return mount(AnalyticsPageHeader, { props: { title: "Analytics", subtitle: "Overview" } });
}

/** The synthetic fixtures' shape: a repository, its folder-only Claude session, folder-only projects. */
const fixtureSessions: SessionListItem[] = [
  { ...copilot, id: "orchard", repository: "example/orchard", cwd: "C:\\synthetic\\orchard" },
  { ...claude, id: "orchard-claude", repository: undefined, cwd: "c:/synthetic/orchard/" },
  { ...copilot, id: "harbor", repository: undefined, cwd: "C:\\synthetic\\harbor" },
  { ...claude, id: "lantern", repository: undefined, cwd: "/home/dev/lantern" },
  { ...copilot, id: "empty", repository: undefined, cwd: "C:\\synthetic\\gallery", turnCount: 0 },
];

describe("AnalyticsPageHeader repository filter", () => {
  beforeEach(() => {
    // Analytics filters and preferences persist; start each case from defaults.
    localStorage.clear();
    setupPinia();
  });

  const repositorySelect = (view: ReturnType<typeof render>) =>
    view.get('select[aria-label="Filter by repository"]');

  it("offers the session list's repository options for every source", async () => {
    const sessions = useSessionsStore();
    sessions.sessions = fixtureSessions;
    const view = render();
    for (const source of [null, "copilot", "claudeCode"] as (SessionSource | null)[]) {
      useAnalyticsStore().setSource(source);
      sessions.filterSource = source;
      for (const hide of [false, true]) {
        usePreferencesStore().hideEmptySessions = hide;
        await view.vm.$nextTick();
        const offered = repositorySelect(view)
          .findAll("option")
          .map((o) => o.attributes("value"))
          .filter(Boolean);
        expect(offered, `source ${source}, hide empty ${hide}`).toEqual(
          sessions.repositoryOptions.map((o) => o.value),
        );
      }
    }
  });

  it("groups folder-only projects under Folders and selects their key", async () => {
    useSessionsStore().sessions = fixtureSessions;
    usePreferencesStore().hideEmptySessions = true;
    const view = render();
    const groups = repositorySelect(view).findAll("optgroup");
    expect(groups.map((g) => g.attributes("label"))).toEqual(["Repositories", "Folders"]);
    expect(groups[0].findAll("option").map((o) => o.text())).toEqual(["example/orchard"]);
    // The orchard folder's Claude session sits under its repository; the
    // empty gallery session is hidden, as on the list.
    expect(groups[1].findAll("option").map((o) => o.text())).toEqual(["harbor", "lantern"]);
    await repositorySelect(view).setValue("project:harbor");
    expect(useAnalyticsStore().selectedRepo).toBe("project:harbor");
  });
});

describe("AnalyticsPageHeader source filter", () => {
  beforeEach(() => {
    setupPinia();
  });

  it("stays hidden while every session comes from Copilot", () => {
    useSessionsStore().sessions = [copilot];
    expect(render().find("[data-testid=analytics-source-filter]").exists()).toBe(false);
  });

  it("offers All, Copilot and Claude Code once both sources have sessions", async () => {
    useSessionsStore().sessions = [copilot, claude];
    const filter = render().get("[data-testid=analytics-source-filter]");
    const options = filter.findAll('[role="radio"]');
    expect(options.map((o) => o.text())).toEqual(["All", "Copilot", "Claude"]);
    expect(options[0].attributes("aria-checked")).toBe("true");

    await options[2].trigger("click");
    expect(useAnalyticsStore().selectedSource).toBe("claudeCode");
    await options[0].trigger("click");
    expect(useAnalyticsStore().selectedSource).toBeNull();
  });
});
