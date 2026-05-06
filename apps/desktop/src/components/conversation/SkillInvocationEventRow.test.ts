import type { TurnSessionEvent, TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import SkillInvocationEventRow from "./SkillInvocationEventRow.vue";

const routerMock = vi.hoisted(() => ({}));
const isFeatureEnabledMock = vi.hoisted(() => vi.fn(() => true));

vi.mock("vue-router", () => ({
  useRouter: () => routerMock,
}));

vi.mock("@/router/navigation", () => ({
  pushRoute: vi.fn(),
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({ isFeatureEnabled: isFeatureEnabledMock }),
}));

function evt(partial: Partial<TurnSessionEvent> & { eventType?: string }): TurnSessionEvent {
  return {
    eventType: "skill.invoked",
    severity: "info",
    summary: "Skill invoked: trace-skill",
    ...partial,
  };
}

function skillTool(partial: Partial<TurnToolCall> = {}): TurnToolCall {
  return {
    toolName: "skill",
    arguments: { skill: "trace-skill" },
    isComplete: true,
    success: true,
    durationMs: 42,
    skillInvocation: {
      contextFolded: true,
      name: "trace-skill",
      description: "Adds tracing helpers.",
      path: "C:\\skills\\trace-skill\\SKILL.md",
      content: "# trace-skill body",
      contentLength: "# trace-skill body".length,
    },
    ...partial,
  };
}

describe("SkillInvocationEventRow", () => {
  beforeEach(() => {
    vi.mocked(pushRoute).mockClear();
    isFeatureEnabledMock.mockReset();
    isFeatureEnabledMock.mockReturnValue(true);
  });

  it("renders a compact, collapsed header with skill name and description", () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            description: "Adds tracing helpers.",
            path: "C:\\skills\\trace-skill\\SKILL.md",
            content: "# trace-skill body",
            contentLength: "# trace-skill body".length,
          },
        }),
      },
    });

    expect(wrapper.text()).toContain("⚡");
    expect(wrapper.text()).toContain("skill");
    expect(wrapper.text()).toContain("trace-skill");
    expect(wrapper.text()).toContain("Adds tracing helpers.");
    // Body is hidden until the user expands.
    expect(wrapper.find(".skill-row__body").exists()).toBe(false);
    expect(wrapper.get(".skill-row__header").attributes("aria-expanded")).toBe("false");
  });

  it("renders inside a skill tool row with tool duration and status", () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        toolCall: skillTool(),
      },
    });

    expect(wrapper.text()).toContain("⚡");
    expect(wrapper.text()).toContain("trace-skill");
    expect(wrapper.text()).toContain("Adds tracing helpers.");
    expect(wrapper.text()).toContain("42ms");
    expect(wrapper.text()).toContain("✓");
  });

  it("expands to show the skill content and path metadata when toggled", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            path: "C:\\skills\\trace-skill\\SKILL.md",
            content: "# trace-skill body",
            contentLength: "# trace-skill body".length,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");

    expect(wrapper.find(".skill-row__body").exists()).toBe(true);
    expect(wrapper.get(".skill-row__content").text()).toContain("# trace-skill body");
    expect(wrapper.text()).toContain("C:\\skills\\trace-skill\\SKILL.md");
    expect(wrapper.get(".skill-row__header").attributes("aria-expanded")).toBe("true");
  });

  it("surfaces a truncation hint when content is shorter than contentLength", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            content: "abc",
            contentLength: 1024,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    expect(wrapper.text()).toMatch(/Showing first 3 of 1,024 characters/);
  });

  it("uses Unicode character counts for truncation hints", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            content: "😀",
            contentLength: 2,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    expect(wrapper.text()).toMatch(/Showing first 1 of 2 characters/);
  });

  it("shows a placeholder when no skill content is captured", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: { contextFolded: false, name: "trace-skill" },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    expect(wrapper.text()).toContain("No skill content captured");
  });

  it("hides the editor button when the skills feature flag is disabled", async () => {
    isFeatureEnabledMock.mockReturnValue(false);

    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            path: "C:\\skills\\trace-skill\\SKILL.md",
            content: "body",
            contentLength: 4,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    expect(wrapper.find(".skill-row__editor-btn").exists()).toBe(false);
  });

  it("hides the editor button when the path does not point to a SKILL.md file", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            path: "C:\\skills\\trace-skill",
            content: "body",
            contentLength: 4,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    expect(wrapper.find(".skill-row__editor-btn").exists()).toBe(false);
  });

  it("opens the skill editor when the button is clicked with a valid path and flag", async () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          skillInvocation: {
            contextFolded: true,
            name: "trace-skill",
            path: "C:\\skills\\trace-skill\\SKILL.md",
            content: "body",
            contentLength: 4,
          },
        }),
      },
    });

    await wrapper.get(".skill-row__header").trigger("click");
    const editorBtn = wrapper.get(".skill-row__editor-btn");
    await editorBtn.trigger("click");

    expect(pushRoute).toHaveBeenCalledWith(routerMock, ROUTE_NAMES.skillEditor, {
      params: { name: encodeURIComponent("C:\\skills\\trace-skill") },
    });
  });

  it("falls back to the summary when the skill payload has no name", () => {
    const wrapper = mount(SkillInvocationEventRow, {
      props: {
        event: evt({
          summary: "Skill invoked",
          skillInvocation: { contextFolded: false },
        }),
      },
    });

    expect(wrapper.text()).toContain("Skill invoked");
  });
});
