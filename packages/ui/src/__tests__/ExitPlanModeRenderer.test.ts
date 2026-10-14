import { mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it } from "vitest";
import ExitPlanModeRenderer from "../components/renderers/ExitPlanModeRenderer.vue";
import { getRendererEntry, hasResultRenderer } from "../components/renderers/registry";
import { ensureMarkdownReady } from "../utils/markdownLoader";

const plan = "# Retry the upload\n\n1. Wrap `send` in a retry.\n2. Run the tests.";

beforeAll(async () => {
  await ensureMarkdownReady();
});

describe("ExitPlanModeRenderer", () => {
  it("is registered under Claude Code's native name with a settings label", () => {
    expect(hasResultRenderer("ExitPlanMode")).toBe(true);
    expect(getRendererEntry("ExitPlanMode")?.label).toBe("Exit Plan Mode (Plan)");
  });

  it("renders the plan as Markdown, separate from the approval response", () => {
    const wrapper = mount(ExitPlanModeRenderer, {
      props: {
        content: "User has approved your plan.",
        args: { plan },
        tc: { toolName: "ExitPlanMode", isComplete: true, success: true },
      },
    });
    expect(wrapper.find(".rs--success").exists()).toBe(true);
    const markdown = wrapper.find(".plan-markdown");
    expect(markdown.find("h1").text()).toBe("Retry the upload");
    expect(markdown.findAll("li")).toHaveLength(2);
    expect(markdown.text()).not.toContain("User has approved");
    expect(wrapper.find(".plan-response pre").text()).toBe("User has approved your plan.");
  });

  it("keeps a rejection visible as an error and works without plan text", () => {
    const wrapper = mount(ExitPlanModeRenderer, {
      props: {
        content: "The user doesn't want to proceed.",
        args: {},
        tc: { toolName: "ExitPlanMode", isComplete: true, success: false },
      },
    });
    expect(wrapper.find(".rs--error").exists()).toBe(true);
    expect(wrapper.find(".plan-markdown").exists()).toBe(false);
    expect(wrapper.text()).toContain("No plan text in the call's input.");
    expect(wrapper.find(".plan-response--error").text()).toBe("The user doesn't want to proceed.");
  });

  it("shows a pending approval until the response arrives", () => {
    const wrapper = mount(ExitPlanModeRenderer, {
      props: { content: "", args: { plan }, tc: { toolName: "ExitPlanMode", isComplete: false } },
    });
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Waiting for the plan to be approved");
  });
});
