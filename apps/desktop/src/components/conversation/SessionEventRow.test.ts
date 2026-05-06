import type { TurnSessionEvent } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import SessionEventRow from "./SessionEventRow.vue";

const routerMock = vi.hoisted(() => ({}));

vi.mock("vue-router", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

vi.mock("@/composables/useCheckpointNavigation", () => ({
  useCheckpointNavigation: () => vi.fn(),
}));

function evt(partial: Partial<TurnSessionEvent> & { eventType: string }): TurnSessionEvent {
  return {
    severity: "info",
    summary: "",
    ...partial,
  };
}

describe("SessionEventRow — skill invocation", () => {
  beforeEach(() => {
    vi.mocked(pushRoute).mockClear();
  });

  it("renders inline with the skill emoji, label, and name", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "skill.invoked",
          summary: "Skill invoked: tracepilot-app-automation",
          skillInvocation: {
            contextFolded: true,
            name: "tracepilot-app-automation",
            description: "Launch and interact with TracePilot.",
            path: "C:\\skills\\tracepilot-app-automation\\SKILL.md",
            contentLength: 1024,
          },
        }),
      },
    });

    expect(wrapper.text()).toContain("⚡");
    expect(wrapper.text()).toContain("skill");
    expect(wrapper.text()).toContain("tracepilot-app-automation");
    expect(wrapper.text()).toContain("Launch and interact with TracePilot.");
    // No expandable/duplicate toggle artefacts.
    expect(wrapper.find(".cv-skill-toggle").exists()).toBe(false);
    expect(wrapper.find(".cv-skill-body").exists()).toBe(false);
  });

  it("renders as a clickable button when a skill path is present and navigates to the editor", async () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "skill.invoked",
          summary: "Skill invoked: trace-skill",
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            path: "C:\\skills\\trace-skill\\SKILL.md",
          },
        }),
      },
    });

    const btn = wrapper.get("button.cv-skill");
    await btn.trigger("click");
    expect(pushRoute).toHaveBeenCalledWith(routerMock, ROUTE_NAMES.skillEditor, {
      params: { name: encodeURIComponent("C:\\skills\\trace-skill") },
    });
  });

  it("renders as a non-clickable div when no skill path is present", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "skill.invoked",
          summary: "Skill invoked: trace-skill",
          skillInvocation: { contextFolded: false, name: "trace-skill" },
        }),
      },
    });

    expect(wrapper.find("button.cv-skill").exists()).toBe(false);
    expect(wrapper.find("div.cv-skill").exists()).toBe(true);
  });

  it("falls back to the summary when the skill payload has no name", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "skill.invoked",
          summary: "Skill invoked",
          skillInvocation: { contextFolded: false },
        }),
      },
    });

    expect(wrapper.text()).toContain("Skill invoked");
  });
});

describe("SessionEventRow — regular events", () => {
  it("renders compaction events with the checkpoint pill", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "session.compaction_complete",
          summary: "Compaction complete",
          checkpointNumber: 7,
        }),
      },
    });

    expect(wrapper.find(".cv-checkpoint-pill").exists()).toBe(true);
    expect(wrapper.text()).toContain("Checkpoint #7");
  });

  it("renders other events with the severity icon and event-type label", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "session.error",
          severity: "error",
          summary: "Boom",
        }),
      },
    });

    expect(wrapper.text()).toContain("⚠️");
    expect(wrapper.text()).toContain("session.error");
    expect(wrapper.text()).toContain("Boom");
  });
});
