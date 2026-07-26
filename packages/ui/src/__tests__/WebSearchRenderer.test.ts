import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import WebSearchRenderer from "../components/renderers/WebSearchRenderer.vue";
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
