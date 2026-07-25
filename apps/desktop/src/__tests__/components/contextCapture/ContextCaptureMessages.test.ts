import type { NormalizedMessage } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextCaptureMessages from "@/components/contextCapture/ContextCaptureMessages.vue";

function item(
  index: number,
  raw: Record<string, unknown>,
  options: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    index,
    role: typeof raw.role === "string" ? raw.role : null,
    itemType: typeof raw.type === "string" ? raw.type : null,
    content: raw.content ?? raw,
    raw,
    bytes: JSON.stringify(raw).length,
    characters: JSON.stringify(raw).length,
    isProbe: false,
    ...options,
  };
}

describe("ContextCaptureMessages", () => {
  it("filters Responses and Anthropic tool traffic without eagerly rendering payloads", async () => {
    const messages = [
      item(0, { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }),
      item(1, { type: "function_call", name: "shell", call_id: "call-secret" }),
      item(2, { type: "function_call_output", call_id: "call-secret", output: "ok" }),
      item(3, { role: "assistant", content: [{ type: "tool_use", id: "anthropic-call" }] }),
      item(4, { role: "user", content: [{ type: "tool_result", tool_use_id: "anthropic-call" }] }),
    ];
    const wrapper = mount(ContextCaptureMessages, { props: { messages } });

    expect(wrapper.text()).toContain("Tool calls 2");
    expect(wrapper.text()).toContain("Tool outputs 2");
    expect(wrapper.html()).not.toContain("call-secret");

    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Tool calls"))
      ?.trigger("click");
    expect(wrapper.findAll("details")).toHaveLength(2);

    const detail = wrapper.find("details");
    (detail.element as HTMLDetailsElement).open = true;
    await detail.trigger("toggle");
    expect(wrapper.html()).toContain("call-secret");
    expect(wrapper.find('[aria-label="Copy JSON"]').exists()).toBe(true);
    expect(wrapper.find(".fcv__file-header").exists()).toBe(false);
  });
});
