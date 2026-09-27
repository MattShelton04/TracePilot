import { flushPromises, mount } from "@vue/test-utils";
import { beforeAll, describe, expect, it, vi } from "vitest";
import WebSearchRenderer from "../components/renderers/WebSearchRenderer.vue";
import ToolCallDetail from "../components/ToolCallDetail.vue";
import ToolDetailPanel from "../components/ToolDetailPanel.vue";
import { EXTERNAL_LINK_HANDLER_KEY } from "../composables/externalLinks";
import { ensureMarkdownReady } from "../utils/markdownLoader";
import { parseWebSearchBody } from "../utils/webSearchResult";

beforeAll(() => ensureMarkdownReady());

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

    await wrapper.get(".ws-body a").trigger("click");
    await wrapper.get(".ws-source-card").trigger("click");

    expect(openExternal).toHaveBeenNthCalledWith(1, "https://example.com/docs");
    expect(openExternal).toHaveBeenNthCalledWith(2, "https://example.com/docs");
  });

  it("emits the URL when no application handler is provided", async () => {
    const wrapper = mountRenderer();

    await wrapper.get(".ws-body a").trigger("click");

    expect(wrapper.emitted("open-external")).toEqual([["https://example.com/docs"]]);
  });
});

describe("web_search result contracts", () => {
  it("unwraps text arrays and MCP content while retaining unknown envelopes", () => {
    expect(
      parseWebSearchBody(JSON.stringify({ text: [{ value: "One" }, { text: "Two" }] })).text,
    ).toBe("One\n\nTwo");
    expect(
      parseWebSearchBody(JSON.stringify({ content: [{ type: "text", text: "Three" }] })).text,
    ).toBe("Three");
    const unknown = '{"unexpected":{"important":"keep me"}}';
    expect(parseWebSearchBody(unknown)).toEqual({
      text: unknown,
      structured: true,
      recognized: false,
    });
    const wrapper = mount(WebSearchRenderer, { props: { content: unknown, args: {} } });
    expect(wrapper.get(".ws-raw-body").text()).toBe(unknown);
  });

  it("renders real Markdown and preserves complete balanced/reference links without remote icons", async () => {
    const content = [
      "## Findings",
      "1. **First**\n2. Second",
      "```ts\nconst unsafe = '<script>';\n```",
      "| Value |\n| --- |\n| useful |",
      "[Nested URL](https://example.com/a_(b)) and [Reference][source]",
      "[source]: https://example.org/reference",
      "[Unsafe](javascript:alert(1)) <img src=x onerror=alert(1)>",
    ].join("\n\n");
    const wrapper = mount(WebSearchRenderer, {
      props: { content, args: { query: "one complete query" } },
    });
    await flushPromises();
    expect(wrapper.findAll(".ws-body ol li")).toHaveLength(2);
    expect(wrapper.get(".ws-body pre code").text()).toContain("<script>");
    expect(wrapper.find(".ws-body table").exists()).toBe(true);
    expect(wrapper.findAll(".ws-source-card").map((link) => link.attributes("href"))).toEqual([
      "https://example.com/a_(b)",
      "https://example.org/reference",
    ]);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
    expect(wrapper.findAll(".ws-query-text")).toHaveLength(1);
    expect(wrapper.find(".rs__hint").exists()).toBe(false);
  });

  it("preserves exact envelopes and unknown non-text fields behind one disclosure", () => {
    const content = JSON.stringify({
      text: "Visible body",
      metadata: { unmatched: "must survive" },
    });
    const wrapper = mount(WebSearchRenderer, { props: { content, args: {} } });
    expect(wrapper.get(".ws-body").text()).toBe("Visible body");
    expect(wrapper.findAll(".recorded-tool-response")).toHaveLength(1);
    expect(wrapper.get(".recorded-tool-response pre").text()).toBe(content);
  });

  it("keeps a long response expandable, reversible, and stable during same-call updates", async () => {
    const callbacks: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const wrapper = mount(WebSearchRenderer, {
        props: {
          content: "Long response",
          args: {},
          tc: { toolName: "web_search", toolCallId: "one", success: true, isComplete: true },
        },
      });
      const viewport = wrapper.get(".renderer-scroll-region__viewport");
      Object.defineProperties(viewport.element, {
        scrollHeight: { value: 700 },
        clientHeight: { value: 400 },
      });
      for (const callback of callbacks) callback();
      await flushPromises();
      const toggle = wrapper.get(".renderer-scroll-region__toggle");
      expect(toggle.text()).toBe("Show all search response");
      await toggle.trigger("click");
      expect(toggle.attributes("aria-expanded")).toBe("true");
      expect(viewport.attributes("style")).toContain("max-height: none");
      await wrapper.setProps({ content: "Long response\n\nAppended result" });
      expect(toggle.attributes("aria-expanded")).toBe("true");
      await toggle.trigger("click");
      expect(toggle.attributes("aria-expanded")).toBe("false");
      await wrapper.setProps({
        tc: { toolName: "web_search", toolCallId: "two", isComplete: true },
      });
      expect(wrapper.get(".renderer-scroll-region__viewport").attributes("style")).toContain(
        "max-height: 400px",
      );
      wrapper.unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("distinguishes pending, empty completed, and failed searches", async () => {
    const wrapper = mount(WebSearchRenderer, {
      props: { content: "", args: {}, tc: { toolName: "web_search", isComplete: false } },
    });
    expect(wrapper.classes()).toContain("rs--pending");
    expect(wrapper.text()).toContain("Searching…");
    await wrapper.setProps({ tc: { toolName: "web_search", isComplete: true } });
    expect(wrapper.classes()).toContain("rs--success");
    expect(wrapper.text()).toContain("No search response returned.");
    await wrapper.setProps({
      tc: { toolName: "web_search", success: false, isComplete: true },
      content: "Rate limit reached",
    });
    expect(wrapper.classes()).toContain("rs--error");
    expect(wrapper.text()).toContain("Rate limit reached");
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
