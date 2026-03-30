import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CodeBlock from "../components/renderers/CodeBlock.vue";

describe("CodeBlock", () => {
  const sampleCode = "const x = 1;\nconst y = 2;\nreturn x + y;";

  it("renders code lines", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode },
    });
    const rows = wrapper.findAll(".code-line");
    expect(rows).toHaveLength(3);
  });

  it("shows line numbers by default", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode },
    });
    const html = wrapper.html();
    expect(html).toContain("<table");
    // With default lineNumbers=true, should NOT see <!--v-if--> for td elements
    // (line number tds should be rendered)
    const rows = wrapper.findAll("tr");
    expect(rows).toHaveLength(3);
    // Each row should have 2 tds
    expect(rows[0].findAll("td").length).toBe(2);
  });

  it("respects startLine prop", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, startLine: 10 },
    });
    const rows = wrapper.findAll("tr");
    expect(rows).toHaveLength(3);
    // First line number td should contain "10"
    expect(rows[0].findAll("td")[0].text()).toBe("10");
  });

  it("hides line numbers when lineNumbers is false", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, lineNumbers: false },
    });
    expect(wrapper.findAll(".code-line-number")).toHaveLength(0);
  });

  it("detects language from filePath", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, filePath: "src/index.ts" },
    });
    expect(wrapper.attributes("data-language")).toBe("typescript");
  });

  it("uses language override when provided", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, filePath: "src/index.ts", language: "json" },
    });
    expect(wrapper.attributes("data-language")).toBe("json");
  });

  it("shows file name in header when filePath given", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, filePath: "src/utils/helper.ts" },
    });
    expect(wrapper.find(".code-block-path").text()).toBe("helper.ts");
  });

  it("shows language badge", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, filePath: "main.rs" },
    });
    // The component should render both the filename and the language in the header
    const html = wrapper.html();
    expect(html).toContain("main.rs");
    // Language detection for .rs should produce "rust", displayed as "Rust"
    expect(html.toLowerCase()).toContain("rust");
  });

  it("collapses lines beyond maxLines", () => {
    const longCode = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`).join("\n");
    const wrapper = mount(CodeBlock, {
      props: { code: longCode, maxLines: 10 },
    });
    const rows = wrapper.findAll(".code-line");
    expect(rows).toHaveLength(10);
    expect(wrapper.find(".code-block-collapsed").exists()).toBe(true);
    expect(wrapper.find(".code-block-collapsed").text()).toContain("40 more lines");
  });

  it("does not show collapsed indicator when under maxLines", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: sampleCode, maxLines: 100 },
    });
    expect(wrapper.find(".code-block-collapsed").exists()).toBe(false);
  });

  it("handles empty code", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: "" },
    });
    // Empty string becomes one empty line
    const rows = wrapper.findAll(".code-line");
    expect(rows.length).toBeLessThanOrEqual(1);
  });

  it("strips trailing empty line", () => {
    const wrapper = mount(CodeBlock, {
      props: { code: "line1\nline2\n" },
    });
    const rows = wrapper.findAll(".code-line");
    expect(rows).toHaveLength(2);
  });
});
