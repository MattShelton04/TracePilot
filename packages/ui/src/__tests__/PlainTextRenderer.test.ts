import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import PlainTextRenderer from "../components/renderers/PlainTextRenderer.vue";

describe("PlainTextRenderer", () => {
  it("renders content in a pre element", () => {
    const wrapper = mount(PlainTextRenderer, {
      props: { content: "Hello world" },
    });
    expect(wrapper.find("pre").text()).toBe("Hello world");
  });

  it("preserves whitespace and newlines", () => {
    const content = "line 1\n  line 2\n    line 3";
    const wrapper = mount(PlainTextRenderer, {
      props: { content },
    });
    expect(wrapper.find("pre").text()).toBe(content);
  });

  it("has the plain-text-renderer class", () => {
    const wrapper = mount(PlainTextRenderer, {
      props: { content: "test" },
    });
    expect(wrapper.find("pre").classes()).toContain("plain-text-renderer");
  });

  it("handles empty string", () => {
    const wrapper = mount(PlainTextRenderer, {
      props: { content: "" },
    });
    expect(wrapper.find("pre").text()).toBe("No output returned.");
  });

  it("pretty-prints a JSON array result with JSON highlighting", () => {
    const content = '[{"number":1,"title":"First issue"}]';
    const wrapper = mount(PlainTextRenderer, { props: { content } });
    const block = wrapper.get(".plain-text-json");
    expect(block.attributes("data-language")).toBe("json");
    expect(wrapper.find(".plain-text-renderer").exists()).toBe(false);
    expect(wrapper.findAll(".code-line").map((line) => line.text())).toEqual([
      "[",
      "{",
      '"number": 1,',
      '"title": "First issue"',
      "}",
      "]",
    ]);
    expect(block.find(".syn-string").exists()).toBe(true);
  });

  it("copies the recorded result, not the re-indented view", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const content = '{"ok":true}';
    const wrapper = mount(PlainTextRenderer, { props: { content } });
    await wrapper.get(".rs__copy").trigger("click");
    expect(writeText).toHaveBeenCalledWith(content);
  });

  it("keeps a truncated JSON preview as plain text", () => {
    const content = '[{"number":1,"title":"First iss';
    const wrapper = mount(PlainTextRenderer, { props: { content } });
    expect(wrapper.find(".plain-text-json").exists()).toBe(false);
    expect(wrapper.get("pre.plain-text-renderer").text()).toBe(content);
  });
});
