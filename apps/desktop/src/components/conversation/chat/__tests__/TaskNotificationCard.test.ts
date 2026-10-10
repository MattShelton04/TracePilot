import type { TaskNotification } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import TaskNotificationCard from "../TaskNotificationCard.vue";

const agent: TaskNotification = {
  taskId: "a1",
  toolUseId: "toolu_ag1",
  kind: "agent",
  status: "completed",
  summary: 'Agent "Map the indexer" finished',
  result: "The indexer has **three** stages.",
  totalTokens: 180_000,
  toolUses: 40,
  durationMs: 600_000,
};
const shell: TaskNotification = {
  taskId: "bsh1",
  toolUseId: "toolu_sh1",
  kind: "shell",
  status: "failed",
  summary: 'Background command "npm run build" failed with exit code 2',
  exitCode: 2,
};

function card(notifications: TaskNotification[], canRevealLaunch?: (id: string) => boolean) {
  return mount(TaskNotificationCard, {
    props: { notifications, turnIndex: 4, eventIndex: 12, renderMarkdown: false, canRevealLaunch },
  });
}

describe("TaskNotificationCard", () => {
  it("labels the turn a notification and lists each task with its status and totals", () => {
    const wrapper = card([agent, shell]);
    const root = wrapper.get('[data-testid="task-notification"]');
    expect(root.attributes("data-event-idx")).toBe("12");
    expect(wrapper.text()).toContain("Notification");
    expect(wrapper.text()).toContain("T4");
    expect(wrapper.text()).not.toContain("User");

    const [first, second] = wrapper.findAll(".cv-notice-task");
    expect(first.text()).toContain('Agent "Map the indexer" finished');
    expect(first.get('[data-tp-component="StatusPill"]').classes()).toContain("pill--success");
    // Totals read as the turn's readable line writes them.
    expect(first.text()).toContain("180K tokens · 40 tool uses · 10m");
    expect(first.text()).not.toContain("10m 0s");
    expect(second.text()).toContain("exit 2");
    expect(second.get('[data-tp-component="StatusPill"]').classes()).toContain("pill--danger");
    expect(second.attributes("data-tool-use-id")).toBe("toolu_sh1");
  });

  it("keeps the report collapsed until it is opened", async () => {
    const wrapper = card([agent, shell]);
    expect(wrapper.text()).not.toContain("three");
    const [toggle] = wrapper.findAll("button").filter((b) => b.text() === "Result");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    await toggle.trigger("click");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".cv-notice-result").text()).toContain("three");
    // The shell has no report to open.
    expect(wrapper.findAll("button").filter((b) => b.text() === "Result")).toHaveLength(1);
  });

  it("offers Go to launch only for launches in the conversation", async () => {
    const wrapper = card([agent, shell], (id) => id === "toolu_ag1");
    const links = wrapper.findAll("button").filter((b) => b.text() === "Go to launch");
    expect(links).toHaveLength(1);
    await links[0].trigger("click");
    expect(wrapper.emitted("revealLaunch")).toEqual([["toolu_ag1"]]);
    expect(card([agent]).text()).not.toContain("Go to launch");
  });

  it("falls back to the kind and status when there is no summary", () => {
    const wrapper = card([{ kind: "shell", status: "stopped" }]);
    expect(wrapper.text()).toContain("Background command stopped");
    expect(wrapper.get('[data-tp-component="StatusPill"]').classes()).toContain("pill--neutral");
  });

  it("shows a Monitor event's payload in view, as a Monitor", () => {
    const monitor: TaskNotification = {
      taskId: "bmon1",
      toolUseId: "toolu_mon1",
      kind: "monitor",
      summary: 'Monitor event: "PR #12 check results"',
      event: "Quality gate: pass\nlint: ok",
    };
    const wrapper = card([monitor, { ...monitor, event: "Quality gate: fail" }]);
    const [first, second] = wrapper.findAll(".cv-notice-task");
    expect(first.get(".cv-notice-kind").attributes("title")).toBe("Monitor");
    expect(first.get(".cv-notice-event").text()).toBe("Quality gate: pass\nlint: ok");
    expect(first.find('[data-tp-component="StatusPill"]').exists()).toBe(false);
    // The same task twice in one record still renders both events.
    expect(second.get(".cv-notice-event").text()).toBe("Quality gate: fail");
  });
});
