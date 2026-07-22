import type { NormalizedToolDefinition } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextCaptureTools from "@/components/contextCapture/ContextCaptureTools.vue";

const tool: NormalizedToolDefinition = {
  index: 0,
  name: "read_file",
  description: "Read a file from the workspace.",
  schema: {
    type: "object",
    required: ["path"],
    properties: {
      path: { type: "string", description: "Absolute file path." },
      encoding: { type: "string", enum: ["utf8", "base64"] },
    },
  },
  raw: { type: "function", name: "read_file" },
  bytes: 200,
  characters: 200,
};

describe("ContextCaptureTools", () => {
  it("renders predictable schema fields and keeps the raw definition available", async () => {
    const wrapper = mount(ContextCaptureTools, { props: { tools: [tool] } });
    const detail = wrapper.find(".capture-tools__list > details");
    (detail.element as HTMLDetailsElement).open = true;
    await detail.trigger("toggle");

    expect(wrapper.text()).toContain("Read a file from the workspace.");
    expect(wrapper.text()).toContain("path");
    expect(wrapper.text()).toContain("string · required");
    expect(wrapper.text()).toContain("Allowed: utf8, base64");
    expect(wrapper.text()).toContain("Raw definition");
  });
});
