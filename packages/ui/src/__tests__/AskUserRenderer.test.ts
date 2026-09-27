import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import AskUserArgsRenderer from "../components/renderers/AskUserArgsRenderer.vue";
import AskUserRenderer from "../components/renderers/AskUserRenderer.vue";
import {
  askUserFields,
  askUserOptionForValue,
  parseStructuredResponse,
} from "../components/renderers/askUserSchema";

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
  const oneOfArgs = {
    message: "Choose the visual review settings.",
    requestedSchema: {
      properties: {
        viewport: {
          type: "string",
          title: "Viewport",
          description: "Choose the review size.",
          oneOf: [
            { const: "desktop", title: "Desktop review" },
            { const: "minimum", title: "Minimum review" },
          ],
          default: "desktop",
        },
      },
      required: ["viewport"],
    },
  };

  it("shows oneOf titles and constants in parameters without treating defaults as answers", () => {
    const wrapper = mount(AskUserArgsRenderer, { props: { args: oneOfArgs } });
    expect(wrapper.findAll(".askuser-enum-pill").map((option) => option.text())).toEqual([
      "Desktop review (desktop)",
      "Minimum review (minimum)",
    ]);
    expect(wrapper.find(".askuser-field-default").text()).toBe("default: Desktop review (desktop)");
    expect(wrapper.text()).toContain("Choose the review size.");
    expect(wrapper.text()).toContain("Required");
    expect(wrapper.find(".askuser-response-check").exists()).toBe(false);
  });

  it("maps current CLI oneOf answers by constant and distinguishes a different schema default", () => {
    const content = "User responded: viewport=minimum, unknown=preserve this field";
    const wrapper = mount(AskUserRenderer, { props: { args: oneOfArgs, content } });
    expect(wrapper.find(".askuser-schema-submitted-value").text()).toBe("Minimum review (minimum)");
    expect(
      wrapper.findAll(".askuser-schema-enum-pill--selected").map((option) => option.text()),
    ).toEqual(["Minimum review (minimum)"]);
    expect(wrapper.find(".askuser-schema-default").text()).toBe(
      "Default: Desktop review (desktop)",
    );
    expect(wrapper.find(".askuser-additional-response").text()).toContain("preserve this field");
    expect(wrapper.find(".recorded-tool-response pre").text()).toBe(content);
  });

  it("never synthesizes a submitted answer from a default in pending or completed-empty results", async () => {
    const wrapper = mount(AskUserRenderer, {
      props: { args: oneOfArgs, content: "", tc: { toolName: "ask_user", isComplete: false } },
    });
    expect(wrapper.text()).toContain("Default: Desktop review (desktop)");
    expect(wrapper.text()).toContain("Awaiting user response");
    expect(wrapper.findAll(".askuser-schema-enum-pill--selected")).toHaveLength(0);
    expect(wrapper.findAll(".askuser-schema-submitted")).toHaveLength(0);
    await wrapper.setProps({ tc: { toolName: "ask_user", isComplete: true, success: true } });
    expect(wrapper.text()).toContain("No response was recorded");
    expect(wrapper.findAll(".askuser-schema-submitted")).toHaveLength(0);
  });

  it("preserves scalar constant types and ignores oneOf constraints without a constant", () => {
    const [field] = askUserFields({
      requestedSchema: {
        properties: {
          value: {
            oneOf: [
              { const: false, title: "Disabled" },
              { const: null, title: "Unset" },
              { const: "", title: "Empty" },
              { const: 1, title: "Numeric one" },
              { const: "1", title: "Text one" },
              { type: "string", title: "An unconstrained string" },
            ],
          },
        },
      },
    });
    expect(field.options.map((option) => option.value)).toEqual([false, null, "", 1, "1"]);
    expect(askUserOptionForValue(field, false)?.title).toBe("Disabled");
    expect(askUserOptionForValue(field, "false")?.title).toBe("Disabled");
    expect(askUserOptionForValue(field, 1)?.title).toBe("Numeric one");
    expect(askUserOptionForValue(field, "1")?.title).toBe("Text one");
    expect(askUserOptionForValue(field, "unknown")).toBeUndefined();
  });

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
