import type { TurnSessionEvent } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import SessionEventRow from "./SessionEventRow.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({}),
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

vi.mock("@/composables/useCheckpointNavigation", () => ({
  useCheckpointNavigation: () => vi.fn(),
}));

// Stub the dedicated skill component so SessionEventRow tests stay focused on
// delegation rather than the skill component's internals.
vi.mock("./SkillInvocationEventRow.vue", () => ({
  default: {
    name: "SkillInvocationEventRow",
    props: ["event"],
    template: '<div class="stub-skill-row" />',
  },
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: () => true }),
}));

function evt(partial: Partial<TurnSessionEvent> & { eventType: string }): TurnSessionEvent {
  return {
    severity: "info",
    summary: "",
    ...partial,
  };
}

describe("SessionEventRow", () => {
  it("delegates skill.invoked events to SkillInvocationEventRow", () => {
    const wrapper = mount(SessionEventRow, {
      props: {
        event: evt({
          eventType: "skill.invoked",
          summary: "Skill invoked: trace-skill",
          skillInvocation: { contextFolded: true, name: "trace-skill" },
        }),
      },
    });

    expect(wrapper.find(".stub-skill-row").exists()).toBe(true);
    // No leftover inline skill chrome.
    expect(wrapper.find(".cv-skill").exists()).toBe(false);
  });

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
