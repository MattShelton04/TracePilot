import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AskUserArgsRenderer from "../components/renderers/AskUserArgsRenderer.vue";
import AskUserRenderer from "../components/renderers/AskUserRenderer.vue";
import { parseStructuredResponse } from "../components/renderers/askUserSchema";

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
  it("keeps unknown response fields and exact submitted payload accessible", () => {
    const content = JSON.stringify({
      enableRollout: false,
      mode: "fast",
      extra: { note: "unknown field retained", flags: [false, null] },
    });
    const wrapper = mount(AskUserRenderer, { props: { content, args: schemaArgs } });
    expect(wrapper.find(".askuser-additional-response").text()).toContain("unknown field retained");
    expect(wrapper.find(".askuser-additional-response").text()).toContain('"flags":[false,null]');
    expect(wrapper.find(".recorded-tool-response pre").text()).toBe(content);
  });

  it("retains key-value fields named like object prototype properties", () => {
    const parsed = parseStructuredResponse(
      "User responded: __proto__=recorded value, constructor=another value",
    );
    expect(parsed?.__proto__).toBe("recorded value");
    expect(Object.hasOwn(parsed ?? {}, "__proto__")).toBe(true);
    expect(parsed?.constructor).toBe("another value");
  });

  it("distinguishes pending, completed-empty and failed requests", async () => {
    const tc = { toolName: "ask_user", isComplete: false };
    const wrapper = mount(AskUserRenderer, {
      props: { content: "", args: { question: "Continue?" }, tc },
    });
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.text()).toContain("Awaiting user response");
    await wrapper.setProps({ tc: { ...tc, isComplete: true, success: true } });
    expect(wrapper.text()).toContain("No response was recorded");
    expect(wrapper.text()).not.toContain("Awaiting user response");
    await wrapper.setProps({ tc: { ...tc, isComplete: true, success: false } });
    expect(wrapper.find(".rs--error").exists()).toBe(true);
    expect(wrapper.text()).toContain("failed without a response");
  });

  it("renders empty strings, nulls and arrays without flattening their meaning", () => {
    const args = { requestedSchema: { properties: { empty: {}, absent: {}, values: {} } } };
    const wrapper = mount(AskUserRenderer, {
      props: { content: '{"empty":"","absent":null,"values":["a,b","c"]}', args },
    });
    expect(wrapper.findAll(".askuser-schema-submitted-value").map((value) => value.text())).toEqual(
      ['""', "null", '["a,b","c"]'],
    );
  });

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

    expect(wrapper.text()).toContain("Response");
    expect(wrapper.text()).toContain("Please keep it conservative.");
  });
});
