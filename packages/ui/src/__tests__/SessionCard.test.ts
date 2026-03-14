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
});
