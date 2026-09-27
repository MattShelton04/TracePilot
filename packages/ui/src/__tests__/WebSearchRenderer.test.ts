import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import WebSearchRenderer from "../components/renderers/WebSearchRenderer.vue";
import ToolCallDetail from "../components/ToolCallDetail.vue";
import ToolDetailPanel from "../components/ToolDetailPanel.vue";
import { EXTERNAL_LINK_HANDLER_KEY } from "../composables/externalLinks";

function mountRenderer(openExternal?: (url: string) => void) {
  return mount(WebSearchRenderer, {
    props: {
      content: "Read [Example](https://example.com/docs) for details.",
      args: { query: "example docs" },
    },
    global: openExternal
      ? {
          provide: {
            [EXTERNAL_LINK_HANDLER_KEY as symbol]: openExternal,
          },
        }
      : undefined,
  });
}

describe("WebSearchRenderer external links", () => {
  it("routes inline and source-card links through the application handler", async () => {
    const openExternal = vi.fn();
    const wrapper = mountRenderer(openExternal);

    await wrapper.get(".ws-link").trigger("click");
    await wrapper.get(".ws-source-card").trigger("click");

    expect(openExternal).toHaveBeenNthCalledWith(1, "https://example.com/docs");
    expect(openExternal).toHaveBeenNthCalledWith(2, "https://example.com/docs");
  });

  it("emits the URL when no application handler is provided", async () => {
    const wrapper = mountRenderer();

    await wrapper.get(".ws-link").trigger("click");

    expect(wrapper.emitted("open-external")).toEqual([["https://example.com/docs"]]);
  });
});

describe("complete web_search output", () => {
  for (const [name, component] of [
    ["conversation", ToolCallDetail],
    ["timeline", ToolDetailPanel],
  ] as const) {
    it(`renders long JSON results and their final sources immediately in ${name}`, async () => {
      const text = `${"Search evidence with Unicode: café. ".repeat(200)}\n\n[Final source](https://example.com/final)`;
      const wrapper = mount(component, {
        props: {
          richEnabled: true,
          tc: {
            toolName: "web_search",
            toolCallId: "search-1",
            isComplete: true,
            success: true,
            arguments: { query: "synthetic reference" },
            resultContent: JSON.stringify({ text: { value: text } }),
          },
        },
      });

      await flushPromises();
      expect(wrapper.get(".ws-body").text()).toContain("Search evidence with Unicode: café.");
      expect(wrapper.get(".ws-body").text()).not.toContain('"value":');
      expect(wrapper.get(".ws-source-card").attributes("href")).toBe("https://example.com/final");
      expect(wrapper.find(".rs-trunc-row").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Show Full Output");
      expect(wrapper.emitted("load-full-result")).toBeUndefined();
    });
  }
});
