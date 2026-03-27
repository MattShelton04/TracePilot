import { describe, it, expect, beforeAll } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import MarkdownContent from "../components/MarkdownContent.vue";

// Pre-load heavy modules so the first test doesn't race module resolution
beforeAll(async () => {
  await Promise.all([import('markdown-it'), import('dompurify')]);
});

/** Mount and wait for the lazy markdown-it/dompurify load + Vue re-render. */
async function mountAndWait(props: { content: string; maxHeight?: string; render?: boolean }) {
  const wrapper = mount(MarkdownContent, { props });
  // Flush import promise → reactive update → Vue re-render chain
  for (let i = 0; i < 4; i++) await flushPromises();
  return wrapper;
}

describe("MarkdownContent", () => {
  it("renders simple markdown as HTML", async () => {
    const wrapper = await mountAndWait({ content: "This is **bold** and *italic*" });
    const html = wrapper.html();
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("renders headings", async () => {
    const wrapper = await mountAndWait({ content: "# Heading 1\n## Heading 2" });
    const html = wrapper.html();
    expect(html).toContain("<h1>Heading 1</h1>");
    expect(html).toContain("<h2>Heading 2</h2>");
  });

  it("renders lists", async () => {
    const wrapper = await mountAndWait({ content: "- Item 1\n- Item 2" });
    const html = wrapper.html();
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>Item 1</li>");
    expect(html).toContain("<li>Item 2</li>");
  });

  it("renders code blocks", async () => {
    const wrapper = await mountAndWait({ content: "```ts\nconst x = 1;\n```" });
    const html = wrapper.html();
    expect(html).toContain("<pre>");
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain("const x = 1;");
  });

  it("renders raw text when render prop is false", async () => {
    const content = "This is **not rendered**";
    const wrapper = await mountAndWait({ content, render: false });
    const el = wrapper.find(".markdown-content");
    expect(el.classes()).toContain("is-raw");
    expect(el.text()).toBe(content);
    expect(wrapper.html()).not.toContain("<strong>");
  });

  it("sanitizes HTML to prevent XSS", async () => {
    // 1. Test that raw HTML tags are escaped/stripped
    const wrapper = await mountAndWait({ content: 'Dangerous <script>alert("xss")</script>' });
    expect(wrapper.html()).not.toContain("<script>");
    expect(wrapper.html()).toContain("&lt;script&gt;");

    // 2. Test that malicious links are neutralized or not rendered as links
    const wrapper2 = await mountAndWait({ content: '[click](javascript:alert(1))' });
    // markdown-it or dompurify will prevent this from being a clickable javascript link
    expect(wrapper2.html()).not.toContain('href="javascript:');
  });

  it("trims extra newlines (fix for reported bug)", async () => {
    const wrapper = await mountAndWait({ content: "\n\n# Hello\n\n\n" });
    const html = wrapper.html();
    expect(html).toContain("<h1>Hello</h1>");
  });

  it("applies maxHeight style", async () => {
    const wrapper = await mountAndWait({ content: "test", maxHeight: "200px" });
    const el = wrapper.find(".markdown-content");
    expect(el.attributes("style")).toContain("max-height: 200px");
    expect(el.attributes("style")).toContain("overflow-y: auto");
  });

  it("forces white-space: normal when rendered", async () => {
    const wrapper = await mountAndWait({ content: "test", render: true });
    const el = wrapper.find(".markdown-content");
    expect(el.classes()).toContain("is-rendered");
  });
});
