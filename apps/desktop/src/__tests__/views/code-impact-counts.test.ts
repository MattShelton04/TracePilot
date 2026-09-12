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
    const uniquePaths = wrapper.findAll(".stat-card")[0];
    expect(uniquePaths.get(".stat-card-value").text()).toBe("1");
    expect(uniquePaths.get(".stat-card-label").text()).toBe("Unique File Paths");
    expect(wrapper.get(".code-count-note").text()).toContain(
      "Matching paths across sessions and repositories count as one unique path",
    );
    expect(wrapper.text()).toContain("File Modifications by Type");
    expect(wrapper.get(".token-bar-value").text()).toBe(modifications);
    expect(wrapper.get(".file-freq").text()).toBe(sessions);
    await wrapper.get(".token-bar").trigger("mouseenter");
    await flushPromises();
    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      `ts — ${modifications}`,
    );
  });
});
