import { setupPinia } from "@tracepilot/test-utils";
import type { SessionListItem } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { useAnalyticsStore } from "@/stores/analytics";
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
