import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AskUserArgsRenderer from "../components/renderers/AskUserArgsRenderer.vue";
import AskUserRenderer from "../components/renderers/AskUserRenderer.vue";

const schemaArgs = {
  message: "Before I continue, choose the rollout behavior.",
  requestedSchema: {
    properties: {
      enableRollout: {
        type: "boolean",
        title: "Enable rollout?",
        default: true,
      },
      mode: {
        type: "string",
        title: "Rollout mode",
        description: "Pick the deployment lane.",
        enum: ["safe", "fast"],
        default: "safe",
      },
      notes: {
        type: "string",
        title: "Extra notes",
      },
    },
    required: ["enableRollout", "mode"],
  },
};

describe("AskUser renderers", () => {
  it("keeps rendering legacy question choices and selected response", () => {
    const wrapper = mount(AskUserRenderer, {
      props: {
        content: "User selected: Option B",
        args: {
          question: "Which option?",
          choices: ["Option A", "Option B"],
          allow_freeform: false,
        },
      },
    });

    expect(wrapper.text()).toContain("Which option?");
    expect(wrapper.text()).toContain("Option B");
    expect(wrapper.find(".askuser-choice-row--selected").text()).toContain("Selected");
  });

  it("renders schema-backed args as multi-field form metadata", () => {
    const wrapper = mount(AskUserArgsRenderer, {
      props: {
        args: schemaArgs,
      },
    });

    expect(wrapper.text()).toContain("Before I continue");
    expect(wrapper.text()).toContain("Enable rollout?");
    expect(wrapper.text()).toContain("Rollout mode");
    expect(wrapper.text()).toContain("Required");
    expect(wrapper.text()).toContain("safe");
    expect(wrapper.text()).toContain("default: true");
  });

  it("renders parsed schema result values", () => {
    const wrapper = mount(AskUserRenderer, {
      props: {
        content: JSON.stringify({ enableRollout: false, mode: "fast", notes: "Ship it" }),
        args: schemaArgs,
      },
    });

    expect(wrapper.text()).toContain("Submitted");
    expect(wrapper.text()).toContain("Enable rollout?");
    expect(wrapper.text()).toContain("false");
    expect(wrapper.text()).toContain("Rollout mode");
    expect(wrapper.text()).toContain("fast");
    expect(wrapper.text()).toContain("Ship it");
    expect(wrapper.find(".askuser-schema-enum-pill--selected").text()).toContain("fast");
    expect(wrapper.findAll(".askuser-schema-field--answered")).toHaveLength(3);
  });

  it("maps CLI key-value schema responses back onto fields", () => {
    const wrapper = mount(AskUserRenderer, {
      props: {
        content: "User responded: enableRollout=true, mode=fast, notes=please include polish",
        args: schemaArgs,
      },
    });

    expect(wrapper.text()).toContain("Submitted");
    expect(wrapper.text()).toContain("true");
    expect(wrapper.text()).toContain("fast");
    expect(wrapper.text()).toContain("please include polish");
    expect(wrapper.find(".askuser-schema-enum-pill--selected").text()).toContain("fast");
    expect(wrapper.find(".askuser-freeform").exists()).toBe(false);
  });

  it("falls back to raw response when schema result is not JSON", () => {
    const wrapper = mount(AskUserRenderer, {
      props: {
        content: "Please keep it conservative.",
        args: schemaArgs,
      },
    });

    expect(wrapper.text()).toContain("Response:");
    expect(wrapper.text()).toContain("Please keep it conservative.");
  });
});
