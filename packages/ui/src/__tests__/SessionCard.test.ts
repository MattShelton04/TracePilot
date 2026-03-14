import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SessionCard from "../components/SessionCard.vue";

describe("SessionCard", () => {
  it("renders session summary", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: {
          id: "test-id",
          summary: "Test session",
          repository: "org/repo",
          branch: "main",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    });
    expect(wrapper.text()).toContain("Test session");
    expect(wrapper.text()).toContain("org/repo");
  });

  it("shows 'Untitled Session' when no summary", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: { id: "test-id" },
      },
    });
    expect(wrapper.text()).toContain("Untitled Session");
  });

  it("emits select on click", async () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: { id: "test-id", summary: "Test" },
      },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")![0]).toEqual(["test-id"]);
  });

  it("shows event count and turn count", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: {
          id: "test-id",
          summary: "Test",
          eventCount: 100,
          turnCount: 5,
        },
      },
    });
    expect(wrapper.text()).toContain("100 events");
    expect(wrapper.text()).toContain("5 turns");
  });

  it("shows relative time for updatedAt", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: {
          id: "test-id",
          summary: "Test",
          updatedAt: new Date(Date.now() - 3600000).toISOString(),
        },
      },
    });
    expect(wrapper.text()).toContain("1h ago");
  });

  it("shows model badge when currentModel is present", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: {
          id: "test-id",
          summary: "Test",
          currentModel: "claude-opus-4.6",
        },
      },
    });
    expect(wrapper.text()).toContain("claude-opus-4.6");
  });

  it("shows repository and branch badges", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: {
          id: "test-id",
          summary: "Test",
          repository: "user/repo",
          branch: "feature-branch",
        },
      },
    });
    expect(wrapper.text()).toContain("user/repo");
    expect(wrapper.text()).toContain("feature-branch");
  });

  it("handles missing optional fields gracefully", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: { id: "test-id" },
      },
    });
    expect(wrapper.text()).not.toContain("events");
    expect(wrapper.text()).not.toContain("turns");
    expect(wrapper.text()).toContain("Untitled Session");
  });
});
