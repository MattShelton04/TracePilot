import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import UserMessageAnchor from "../UserMessageAnchor.vue";

const { getPromptImage } = vi.hoisted(() => ({ getPromptImage: vi.fn() }));
vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({ getPromptImage });
});

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

  it("copies the whole prompt as text, pasted blocks included but not their wrapper tags", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const wrapper = anchor(
      'Fix **this**:\n\n<pasted_content id="4">\nalpha\nbeta\n</pasted_content id="4">',
    );
    const button = wrapper.get('.cv-user-header button[aria-label="Copy prompt"]');
    await button.trigger("click");
    await flushPromises();
    expect(writeText).toHaveBeenCalledExactlyOnceWith("Fix **this**:\n\nalpha\nbeta");
    expect(button.attributes("aria-label")).toBe("Copied");
  });

  it("renders a prompt without pasted text as before", () => {
    const wrapper = anchor("/model claude-opus-5-5");
    expect(wrapper.find('[data-testid="pasted-content"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("/model claude-opus-5-5");
  });
});

describe("UserMessageAnchor images", () => {
  const preview = {
    base64Data: "iVBORw0KGgo=",
    width: 4,
    height: 3,
    originalWidth: 4,
    originalHeight: 3,
    originalSizeBytes: 12,
    originalFormat: "png",
    wasDownscaled: false,
    animationOmitted: false,
  };

  it("shows each attached image under the prompt, read by its event and index", async () => {
    getPromptImage.mockReset();
    getPromptImage.mockResolvedValueOnce(preview).mockRejectedValueOnce(new Error("gone"));
    const wrapper = mount(UserMessageAnchor, {
      props: {
        content: "the dot is off, see the screenshots",
        turnIndex: 2,
        eventIndex: 41,
        sessionId: "s-images",
        renderMarkdown: false,
        attachments: [
          { type: "image", mediaType: "image/png", line: 7, pointer: "/attachment/prompt/0" },
          { type: "image", mediaType: "image/png", line: 7, pointer: "/attachment/prompt/1" },
        ],
      },
    });
    await flushPromises();
    expect(getPromptImage.mock.calls).toEqual([
      ["s-images", 41, 0],
      ["s-images", 41, 1],
    ]);
    const img = wrapper.get(".cv-prompt-images img");
    expect(img.attributes("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(img.attributes("alt")).toBe("Pasted image 1");
    expect(wrapper.get(".cv-prompt-image--missing").text()).toContain("Pasted image 2 unavailable");
  });

  it("reads nothing for a prompt without images", () => {
    getPromptImage.mockReset();
    const wrapper = mount(UserMessageAnchor, {
      props: {
        content: "hello",
        turnIndex: 0,
        eventIndex: 1,
        sessionId: "s-images",
        renderMarkdown: false,
        attachments: [{ type: "selection", filePath: "a.ts" }],
      },
    });
    expect(wrapper.find(".cv-prompt-images").exists()).toBe(false);
    expect(getPromptImage).not.toHaveBeenCalled();
  });
});
