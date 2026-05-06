import type { TurnSessionEvent } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import SkillInvocationEventRow from "./SkillInvocationEventRow.vue";

const routerMock = vi.hoisted(() => ({}));

vi.mock("vue-router", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

function evt(
  overrides: Partial<NonNullable<TurnSessionEvent["skillInvocation"]>>,
): TurnSessionEvent {
  return {
    eventType: "skill.invoked",
    severity: "info",
    summary: "Skill invoked: tracepilot-app-automation",
    skillInvocation: {
      contextFolded: false,
      ...overrides,
    },
  };
}

describe("SkillInvocationEventRow", () => {
  beforeEach(() => {
    vi.mocked(pushRoute).mockClear();
  });

  it("renders a compact, collapsed row by default", () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          name: "tracepilot-app-automation",
          description: "Launch and interact with TracePilot.",
          path: "C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation\\SKILL.md",
          contentLength: 16128,
        }),
      },
    });

    const toggle = wrapper.get("button.cv-skill-toggle");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).toContain("skill");
    expect(wrapper.text()).toContain("tracepilot-app-automation");
    // No internal skill icon — the surrounding tool-call layer already provides one.
    expect(wrapper.find(".cv-skill-icon").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("⚡");
    // Description and path should NOT appear in collapsed state.
    expect(wrapper.text()).not.toContain("Launch and interact with TracePilot.");
    expect(wrapper.text()).not.toContain("SKILL.md");
    expect(wrapper.find(".cv-skill-body").exists()).toBe(false);
  });

  it("expands to reveal the skill preview, metadata, and editor action on toggle", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          name: "tracepilot-app-automation",
          description: "Launch and interact with TracePilot.",
          path: "C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation\\SKILL.md",
          contentLength: 16128,
        }),
      },
    });

    await wrapper.get("button.cv-skill-toggle").trigger("click");

    const toggle = wrapper.get("button.cv-skill-toggle");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    expect(wrapper.find(".cv-skill-body").exists()).toBe(true);
    expect(wrapper.text()).toContain("Skill preview");
    expect(wrapper.text()).toContain("Launch and interact with TracePilot.");
    expect(wrapper.text()).toContain("SKILL.md");
    expect(wrapper.text()).toContain("16,128");
    expect(wrapper.find(".cv-skill-action").exists()).toBe(true);
    // The misleading "new view" hint must not be present.
    expect(wrapper.text()).not.toContain("new view");
    expect(wrapper.find(".cv-skill-action-hint").exists()).toBe(false);
  });

  it("collapses again on a second toggle click", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: { event: evt({ name: "x", description: "desc" }) },
    });

    const toggle = wrapper.get("button.cv-skill-toggle");
    await toggle.trigger("click");
    expect(wrapper.find(".cv-skill-body").exists()).toBe(true);
    expect(toggle.attributes("aria-expanded")).toBe("true");
    await toggle.trigger("click");
    expect(wrapper.find(".cv-skill-body").exists()).toBe(false);
    expect(toggle.attributes("aria-expanded")).toBe("false");
  });

  it("opens the skill editor only via the expanded action button", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          name: "tracepilot-app-automation",
          path: "C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation\\SKILL.md",
        }),
      },
    });

    // Clicking the toggle row expands but does NOT navigate.
    await wrapper.get("button.cv-skill-toggle").trigger("click");
    expect(pushRoute).not.toHaveBeenCalled();

    await wrapper.get("button.cv-skill-action").trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(routerMock, ROUTE_NAMES.skillEditor, {
      params: {
        name: encodeURIComponent("C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation"),
      },
    });
  });

  it("does not render an editor action when no skill path is present", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: { event: evt({ name: "tracepilot-app-automation", description: "Something." }) },
    });

    await wrapper.get("button.cv-skill-toggle").trigger("click");

    expect(wrapper.find(".cv-skill-body").exists()).toBe(true);
    expect(wrapper.find(".cv-skill-action").exists()).toBe(false);
    expect(pushRoute).not.toHaveBeenCalled();
  });

  it("gracefully renders an empty-state preview when no description is provided", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: { event: evt({ name: "tracepilot-app-automation" }) },
    });

    await wrapper.get("button.cv-skill-toggle").trigger("click");

    expect(wrapper.find(".cv-skill-body").exists()).toBe(true);
    expect(wrapper.text()).toContain("Skill preview");
    expect(wrapper.text()).toContain("No description provided.");
  });
});
