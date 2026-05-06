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

function evt(overrides: Partial<TurnSessionEvent["skillInvocation"]>): TurnSessionEvent {
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

  it("renders folded skill invocation metadata without raw skill context", () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          name: "tracepilot-app-automation",
          description: "Launch and interact with TracePilot.",
          path: "C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation\\SKILL.md",
          contextFolded: true,
          contextLength: 16285,
        }),
      },
    });

    expect(wrapper.text()).toContain("skill invoked");
    expect(wrapper.text()).toContain("tracepilot-app-automation");
    expect(wrapper.text()).toContain("Launch and interact with TracePilot.");
    expect(wrapper.text()).toContain("context folded");
    expect(wrapper.text()).toContain("…skills\\tracepilot-app-automation\\SKILL.md");
    expect(wrapper.text()).not.toContain("<skill-context");
  });

  it("opens path-backed skill invocations in the skill editor", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          name: "tracepilot-app-automation",
          path: "C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation\\SKILL.md",
        }),
      },
    });

    await wrapper.get(".cv-skill-invoked").trigger("click");

    expect(pushRoute).toHaveBeenCalledWith(routerMock, ROUTE_NAMES.skillEditor, {
      params: {
        name: encodeURIComponent("C:\\git\\TracePilot\\.github\\skills\\tracepilot-app-automation"),
      },
    });
  });

  it("does not navigate when the invocation has no skill path", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({ name: "tracepilot-app-automation" }),
      },
    });

    await wrapper.get(".cv-skill-invoked").trigger("click");

    expect(pushRoute).not.toHaveBeenCalled();
  });
});
