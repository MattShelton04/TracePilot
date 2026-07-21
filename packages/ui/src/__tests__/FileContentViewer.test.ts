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

  it("renders a sanitized image preview for image fileType", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "files/screenshot.png",
        fileType: "image",
        imagePreview: {
          base64Data: "c2FmZS1wbmc=",
          width: 800,
          height: 600,
          originalWidth: 800,
          originalHeight: 600,
          originalSizeBytes: 1024,
          originalFormat: "png",
          wasDownscaled: false,
          animationOmitted: false,
        },
      },
    });
    expect(wrapper.find("img").attributes("src")).toBe("data:image/png;base64,c2FmZS1wbmc=");
    expect(wrapper.text()).toContain("800×600");
  });

  it("zooms an image with the mouse wheel", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "files/screenshot.png",
        fileType: "image",
        imagePreview: {
          base64Data: "c2FmZS1wbmc=",
          width: 800,
          height: 600,
          originalWidth: 800,
          originalHeight: 600,
          originalSizeBytes: 1024,
          originalFormat: "png",
          wasDownscaled: false,
          animationOmitted: false,
        },
      },
    });
    Object.defineProperty(wrapper.get("img").element, "clientWidth", { value: 800 });
    wrapper
      .get(".image-viewer__canvas")
      .element.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, deltaY: -100, clientX: 20, clientY: 20 }),
      );
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("115%");
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

  it("renders JSON, JSONL, and CSV with structured viewers", () => {
    const json = mount(FileContentViewer, {
      props: { filePath: "data.json", fileType: "json", content: '{"ok":true}' },
    });
    expect(json.find(".structured-viewer__tree").exists()).toBe(true);

    const jsonl = mount(FileContentViewer, {
      props: {
        filePath: "events.jsonl",
        fileType: "jsonl",
        content: '{"type":"session.start","id":"123456789"}\n',
      },
    });
    expect(jsonl.find(".jsonl-viewer__records").exists()).toBe(true);
    expect(jsonl.text()).toContain("session.start");

    const csv = mount(FileContentViewer, {
      props: { filePath: "data.csv", fileType: "csv", content: "name,value\nalpha,1\n" },
    });
    expect(csv.find(".csv-viewer__table").exists()).toBe(true);
    expect(csv.text()).toContain("alpha");
  });

  it("renders large JSONL in records mode without chunk gating", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "large.jsonl",
        fileType: "jsonl",
        content: JSON.stringify({ type: "large.record", payload: "x".repeat(520_000) }),
      },
    });

    expect(wrapper.find(".jsonl-viewer__records").exists()).toBe(true);
    expect(wrapper.text()).toContain("large.record");
    expect(wrapper.text()).not.toContain("Structure this chunk");
    expect(wrapper.find(".json-node").exists()).toBe(false);

    const details = wrapper.get(".jsonl-viewer__record");
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger("toggle");
    expect(wrapper.find(".json-node").exists()).toBe(true);
  });

  it("uses a tab delimiter for TSV files", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "data.tsv",
        fileType: "csv",
        content: "name\tvalue\nalpha\t1\n",
      },
    });
    expect(wrapper.text()).toContain("tab delimiter");
    expect(wrapper.findAll(".csv-viewer__table th")).toHaveLength(3);
  });

  it("emits structured-view preference changes", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "data.json",
        fileType: "json",
        content: '{"ok":true}',
        jsonMode: "tree",
      },
    });
    const rawButton = wrapper
      .findAll(".structured-viewer__modes button")
      .find((button) => button.text() === "Raw");
    await rawButton?.trigger("click");
    expect(wrapper.emitted("update:json-mode")?.[0]).toEqual(["raw"]);
  });

  it("opens find-in-file, highlights matches, and navigates them", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "notes.txt",
        fileType: "text",
        content: "needle one\nother\nneedle two",
      },
    });
    await wrapper.get('[aria-label="Find in file"]').trigger("click");
    await wrapper.get('[aria-label="Find in selected file"]').setValue("needle");

    expect(wrapper.findAll("mark.code-search-match")).toHaveLength(2);
    expect(wrapper.text()).toContain("1/2");
    await wrapper.get('[aria-label="Next match"]').trigger("click");
    expect(wrapper.text()).toContain("2/2");
  });

  it("focuses and highlights a session-wide content-search result", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "notes.txt",
        fileType: "text",
        content: "first\nneedle\nlast",
        searchRequestId: 1,
        initialSearchQuery: "needle",
        initialSearchLine: 2,
      },
    });
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[aria-label="Find in selected file"]').element).toBeTruthy();
    expect(wrapper.find("mark.code-search-match--active").text()).toBe("needle");
  });

  it("offers an explicit larger bounded read for truncated previews", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "events.jsonl",
        fileType: "jsonl",
        content: "{}",
        canLoadMore: true,
      },
    });
    await wrapper.get(".fcv__load-more button").trigger("click");
    expect(wrapper.emitted("load-full")).toHaveLength(1);
  });

  it("keeps Markdown rendered while highlighting find results", async () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "plan.md",
        fileType: "markdown",
        content: "# Plan\nFind the needle here.",
        markdownMode: "rendered",
      },
    });
    await wrapper.get('[aria-label="Find in file"]').trigger("click");
    await wrapper.get('[aria-label="Find in selected file"]').setValue("needle");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".markdown-content").exists()).toBe(true);
    expect(wrapper.find(".code-block").exists()).toBe(false);
    expect(wrapper.find("mark.markdown-search-match").text()).toBe("needle");
  });

  it("offers copy path for SQLite files", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "session.db",
        absolutePath: "C:/sessions/session.db",
        fileType: "sqlite",
        dbData: [],
      },
    });
    expect(wrapper.find('[aria-label="Copy file path"]').exists()).toBe(true);
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

  it("renders Markdown modes in a fixed container above the scrollable body", () => {
    const wrapper = mount(FileContentViewer, {
      props: {
        filePath: "plan.md",
        fileType: "markdown",
        content: "# Plan\nSome text.",
        markdownMode: "rendered",
      },
    });
    expect(wrapper.find(".fcv__markdown-container").exists()).toBe(true);
    expect(wrapper.find(".fcv__markdown-modes").exists()).toBe(true);
    expect(wrapper.find(".fcv__markdown-body").exists()).toBe(true);
    expect(wrapper.find(".fcv__markdown-body .markdown-content").exists()).toBe(true);
  });
});
