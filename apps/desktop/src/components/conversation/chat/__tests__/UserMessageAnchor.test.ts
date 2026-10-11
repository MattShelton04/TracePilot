import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import UserMessageAnchor from "../UserMessageAnchor.vue";

function anchor(content: string) {
  return mount(UserMessageAnchor, {
    props: { content, turnIndex: 0, renderMarkdown: false },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UserMessageAnchor pasted text", () => {
  it("frames pasted text apart from the typed prompt, without the wrapper tags", () => {
    const wrapper = anchor(
      'Review:\n\n<pasted_content id="3">\nfirst\nsecond\n</pasted_content id="3">',
    );
    expect(wrapper.text()).not.toContain("pasted_content");
    const block = wrapper.get('[data-testid="pasted-content"]');
    expect(block.text()).toContain("Pasted text · 2 lines");
    expect(block.text()).toContain("first");
    expect(block.get("button").attributes("aria-expanded")).toBe("true");
  });

  it("collapses a long paste until it is opened", async () => {
    const body = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const wrapper = anchor(`<pasted_content id="9">\n${body}\n</pasted_content id="9">`);
    const block = wrapper.get('[data-testid="pasted-content"]');
    expect(block.text()).toContain("Pasted text · 20 lines");
    expect(block.text()).not.toContain("line 0");
    await block.get("button").trigger("click");
    expect(block.text()).toContain("line 0");
  });

  it("copies the pasted text without toggling the block", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = anchor(
      'Fix:\n\n<pasted_content id="4">\nalpha\nbeta\n</pasted_content id="4">',
    );
    const block = wrapper.get('[data-testid="pasted-content"]');
    await block.get(".cv-pasted-copy").trigger("click");
    expect(writeText).toHaveBeenCalledWith("alpha\nbeta");
    expect(block.get(".cv-pasted-toggle").attributes("aria-expanded")).toBe("true");
  });

  it("renders a prompt without pasted text as before", () => {
    const wrapper = anchor("/model claude-opus-5-5");
    expect(wrapper.find('[data-testid="pasted-content"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("/model claude-opus-5-5");
  });
});
