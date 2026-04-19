import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import FileContentViewer from "../components/FileContentViewer.vue";

describe("FileContentViewer", () => {
  it("shows empty state when no filePath and not loading", () => {
    const wrapper = mount(FileContentViewer, { props: {} });
    expect(wrapper.text()).toContain("Select a file");
  });

  it("shows loading spinner when loading is true", () => {
    const wrapper = mount(FileContentViewer, {
      props: { filePath: "plan.md", loading: true },
    });
    expect(wrapper.text()).toContain("Loading");
    expect(wrapper.find(".fcv__spinner").exists()).toBe(true);
  });

  it("shows error message when error is provided", () => {
    const wrapper = mount(FileContentViewer, {
      props: { filePath: "plan.md", error: "Permission denied" },
    });
    expect(wrapper.text()).toContain("Permission denied");
    expect(wrapper.find(".fcv__error").exists()).toBe(true);
  });

  it("renders SQLite placeholder for sqlite fileType", () => {
    const wrapper = mount(FileContentViewer, {
      props: { filePath: "session.db", fileType: "sqlite" },
    });
    expect(wrapper.text()).toContain("SQLite Database");
    expect(wrapper.find(".fcv__binary").exists()).toBe(true);
  });

  it("renders binary placeholder for binary fileType", () => {
    const wrapper = mount(FileContentViewer, {
      props: { filePath: "archive.zip", fileType: "binary" },
    });
    expect(wrapper.text()).toContain("Binary File");
    expect(wrapper.find(".fcv__binary").exists()).toBe(true);
    expect(wrapper.text()).toContain("archive.zip");
    // Must not render empty pane
    expect(wrapper.text()).not.toBe("");
  });

  it("renders file header and content for text content", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "workspace.yaml",
        fileType: "yaml",
        content: "cwd: /home/user\n",
      },
    });
    expect(wrapper.find(".fcv__file-header").exists()).toBe(true);
    expect(wrapper.text()).toContain("workspace.yaml");
    expect(wrapper.find(".fcv__content").exists()).toBe(true);
  });

  it("renders markdown content for markdown fileType", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "plan.md",
        fileType: "markdown",
        content: "# Plan\nSome text.",
      },
    });
    expect(wrapper.find(".fcv__content").exists()).toBe(true);
    // MarkdownContent or CodeBlock should be rendered inside .fcv__content
    expect(wrapper.find(".fcv__content").html()).toBeTruthy();
  });

  it("does NOT show binary placeholder for non-binary types with undefined content", () => {
    // loading=false, error=null, content=undefined, fileType='text' → should render file header area or empty
    // Key: must NOT render blank (the 'binary' branch must not swallow non-binary files)
    const wrapper = mount(FileContentViewer, {
      props: { filePath: "notes.txt", fileType: "text" },
    });
    // No binary heading
    expect(wrapper.text()).not.toContain("Binary File");
    expect(wrapper.text()).not.toContain("SQLite Database");
  });
});
