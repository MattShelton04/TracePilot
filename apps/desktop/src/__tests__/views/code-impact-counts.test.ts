import { setupPinia } from "@tracepilot/test-utils";
import type { CodeImpactData } from "@tracepilot/types";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CodeImpactView from "@/views/CodeImpactView.vue";

const { getCodeImpact } = vi.hoisted(() => ({ getCodeImpact: vi.fn() }));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../mocks/client");
  return createClientMock({
    checkConfigExists: vi.fn().mockResolvedValue(false),
    getConfig: vi.fn().mockResolvedValue(null),
    getCodeImpact,
  });
});

enableAutoUnmount(afterEach);
beforeEach(() => {
  setupPinia();
  vi.clearAllMocks();
});

describe("CodeImpactView count units", () => {
  it.each<[number, string, string]>([
    [70, "70 modifications", "70 sessions"],
    [1, "1 modification", "1 session"],
  ])("distinguishes one path from %i session modifications", async (count, modifications, sessions) => {
    // The same recorded path appears in each session; the backend aggregates
    // one unique path but counts each session/file occurrence by type.
    const data: CodeImpactData = {
      filesModified: 1,
      linesAdded: 70,
      linesRemoved: 0,
      netChange: 70,
      fileTypeBreakdown: [{ extension: "ts", count, percentage: 100 }],
      mostModifiedFiles: [{ path: "src/status.ts", additions: count, deletions: 0 }],
      changesByDay: [],
    };
    getCodeImpact.mockResolvedValue(data);
    const wrapper = mount(CodeImpactView, {
      global: { stubs: { RouterLink: { template: "<a><slot /></a>", props: ["to"] } } },
    });
    await flushPromises();
    const tips = [...document.body.querySelectorAll('[role="tooltip"]')].map(
      (t) => t.textContent ?? "",
    );

    // One unique path, however many sessions touched it.
    const files = wrapper
      .get('[data-testid="code-kpis"]')
      .findAll(".kpi")
      .find((kpi) => kpi.text().includes("Files touched"));
    expect(files?.get(".kpi__value-num").text()).toBe("1");
    expect(files?.text()).toContain(modifications);
    expect(
      tips.some((t) => t.startsWith("Unique paths across repositories: a file counts once")),
    ).toBe(true);

    // File types count modifications; files count sessions.
    expect(tips).toContain(`.ts: ${modifications}, 100% of all`);
    expect(wrapper.get('[data-testid="code-file-row"]').text()).toContain(String(count));
    expect(tips).toContain(`src/status.ts · modified in ${sessions}`);
  });
});
