import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";
import { formatMarkdownBlock, useSkillMarkdownToolbar } from "../skillEditor/markdownToolbar";

afterEach(() => {
  document.body.replaceChildren();
});

describe("formatMarkdownBlock", () => {
  it.each([0, 7, 27])("keeps a collapsed caret in its original content at offset %s", (caret) => {
    const original = "Review only disposable files.\n\nPreserve Unicode café 日本語.";
    const result = formatMarkdownBlock(original, caret, caret, "# ");
    expect(result.text).toBe(`# ${original}`);
    expect(result.selectionStart).toBe(caret + 2);
    expect(result.selectionEnd).toBe(caret + 2);
  });

  it("formats the current line and replaces an existing heading without duplicating it", () => {
    const result = formatMarkdownBlock("Intro\n# café 日本語\nAfter", 10, 16, "## ");
    expect(result.text).toBe("Intro\n## café 日本語\nAfter");
    expect(result.text.slice(result.selectionStart, result.selectionEnd)).toBe("fé 日本語");
    expect(
      formatMarkdownBlock(result.text, result.selectionStart, result.selectionEnd, "## "),
    ).toEqual(result);
  });

  it("preserves indentation and blank lines while replacing heading/list markers", () => {
    const source = "  ## First\n\n  2. café 日本語\n  + Last\nUntouched";
    const end = source.indexOf("Untouched");
    const result = formatMarkdownBlock(source, 5, end, "- ");
    expect(result.text).toBe("  - First\n\n  - café 日本語\n  - Last\nUntouched");
    expect(result.text.slice(result.selectionEnd)).toBe("Untouched");
  });

  it.each(["", "\nAfter", "   "])("adds only a marker to an empty current line (%j)", (text) => {
    const result = formatMarkdownBlock(text, 0, 0, "# ");
    const indent = text.match(/^ */)?.[0] ?? "";
    expect(result.text).toBe(`${indent}# ${text.slice(indent.length)}`);
    expect(result.selectionStart).toBe(indent.length + 2);
    expect(result.selectionEnd).toBe(result.selectionStart);
  });

  it("formats an empty final line without changing the previous line", () => {
    expect(formatMarkdownBlock("Done\n", 5, 5, "- ")).toEqual({
      text: "Done\n- ",
      selectionStart: 7,
      selectionEnd: 7,
    });
  });
});

describe("useSkillMarkdownToolbar", () => {
  function setup(text: string, start: number, end = start) {
    const editor = document.createElement("textarea");
    document.body.append(editor);
    editor.value = text;
    editor.setSelectionRange(start, end);
    editor.scrollTop = 120;
    const readOnly = ref(false);
    const update = vi.fn((body: string) => {
      editor.value = body;
    });
    const toolbar = useSkillMarkdownToolbar(ref(editor), readOnly, update);
    return { editor, update, readOnly, toolbar };
  }

  it.each([
    ["insertBold", "**café 日本語**", 2],
    ["insertItalic", "*café 日本語*", 1],
    ["insertCode", "`café 日本語`", 1],
    ["insertLink", "[café 日本語](url)", 1],
  ] as const)("preserves %s selection, focus and scroll behavior", async (action, expected, prefixLength) => {
    const { toolbar, editor } = setup("café 日本語", 0, 8);
    toolbar[action]();
    await nextTick();
    expect(editor.value).toBe(expected);
    expect(editor.selectionStart).toBe(prefixLength);
    expect(editor.selectionEnd).toBe(prefixLength + 8);
    expect(document.activeElement).toBe(editor);
    expect(editor.scrollTop).toBe(120);
  });

  it("does not dirty an unchanged block or mutate read-only content", async () => {
    const { toolbar, editor, update, readOnly } = setup("# Existing", 5);
    toolbar.insertH1();
    await nextTick();
    expect(update).not.toHaveBeenCalled();
    expect(editor.selectionStart).toBe(5);
    readOnly.value = true;
    toolbar.insertH2();
    toolbar.insertBold();
    expect(editor.value).toBe("# Existing");
    expect(update).not.toHaveBeenCalled();
  });
});
