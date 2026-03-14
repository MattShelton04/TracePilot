import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SessionList from "../components/SessionList.vue";
import type { SessionListItem } from "@tracepilot/types";

function mockSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: "test-123",
    summary: "Test session",
    repository: "user/repo",
    branch: "main",
    hostType: "cli",
    eventCount: 100,
    turnCount: 5,
    currentModel: "claude-opus-4.6",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    ...overrides,
  } as SessionListItem;
}

describe("SessionList", () => {
  it("renders empty state when sessions array is empty", () => {
    const wrapper = mount(SessionList, {
      props: { sessions: [] },
    });
    expect(wrapper.text()).toContain("No sessions found");
  });

  it("renders SessionCard for each session", () => {
    const sessions = [
      mockSession({ id: "s1", summary: "First session" }),
      mockSession({ id: "s2", summary: "Second session" }),
      mockSession({ id: "s3", summary: "Third session" }),
    ];
    const wrapper = mount(SessionList, {
      props: { sessions },
    });
    expect(wrapper.text()).toContain("First session");
    expect(wrapper.text()).toContain("Second session");
    expect(wrapper.text()).toContain("Third session");
  });

  it("emits 'select' event when a card is clicked", async () => {
    const sessions = [mockSession({ id: "click-me", summary: "Clickable" })];
    const wrapper = mount(SessionList, {
      props: { sessions },
    });
    await wrapper.find("[role='button']").trigger("click");
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["click-me"]);
  });

  it("renders responsive grid layout", () => {
    const sessions = [mockSession()];
    const wrapper = mount(SessionList, {
      props: { sessions },
    });
    const grid = wrapper.find(".grid");
    expect(grid.exists()).toBe(true);
    expect(grid.classes()).toContain("grid-cols-1");
  });
});
