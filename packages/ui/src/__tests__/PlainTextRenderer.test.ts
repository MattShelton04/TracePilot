import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
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
    expect(wrapper.find("pre").text()).toBe("");
  });
});
