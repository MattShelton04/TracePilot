import { nextTick, type Ref } from "vue";

type TextEdit = { text: string; selectionStart: number; selectionEnd: number };

/** Apply one block style to complete affected lines, retaining content and selection. */
export function formatMarkdownBlock(
  text: string,
  start: number,
  end: number,
  prefix: string,
): TextEdit {
  start = Math.max(0, Math.min(text.length, start));
  end = Math.max(start, Math.min(text.length, end));
  const lineStart = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  // A selection ending at the next line's start does not include that line.
  const includedEnd = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const nextNewline = text.indexOf("\n", includedEnd);
  const lineEnd = nextNewline < 0 ? text.length : nextNewline;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  let oldOffset = lineStart;
  let newOffset = lineStart;
  const offsets: { old: number; next: number; length: number; before: number; after: number }[] =
    [];
  const replacement = lines
    .map((line) => {
      const indent = line.match(/^[\t ]*/)?.[0] ?? "";
      const content = line.slice(indent.length);
      const marker = content.match(/^(?:#{1,6}|[-+*]|\d+[.)])(?:[\t ]+|$)/)?.[0] ?? "";
      const skip = lines.length > 1 && !content;
      const next = skip ? line : indent + prefix + content.slice(marker.length);
      offsets.push({
        old: oldOffset,
        next: newOffset,
        length: line.length,
        before: skip ? 0 : indent.length + marker.length,
        after: skip ? 0 : indent.length + prefix.length,
      });
      oldOffset += line.length + 1;
      newOffset += next.length + 1;
      return next;
    })
    .join("\n");

  function mapPosition(position: number) {
    const line = offsets.find((entry) => position <= entry.old + entry.length);
    if (!line) return position + replacement.length - (lineEnd - lineStart);
    const within = position - line.old;
    return line.next + line.after + Math.max(0, within - line.before);
  }
  return {
    text: text.slice(0, lineStart) + replacement + text.slice(lineEnd),
    selectionStart: mapPosition(start),
    selectionEnd: mapPosition(end),
  };
}

export function useSkillMarkdownToolbar(
  editorRef: Ref<HTMLTextAreaElement | null>,
  isReadOnly: Readonly<Ref<boolean>>,
  updateBody: (body: string) => void,
) {
  function apply(format: (element: HTMLTextAreaElement) => TextEdit) {
    const element = editorRef.value;
    if (isReadOnly.value || !element) return;
    const scrollTop = element.scrollTop;
    const edit = format(element);
    if (edit.text !== element.value) updateBody(edit.text);
    nextTick(() => {
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
      element.scrollTop = scrollTop;
    });
  }

  function inline(prefix: string, suffix = "") {
    apply((element) => {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      const inner = element.value.slice(start, end) || "text";
      return {
        text: element.value.slice(0, start) + prefix + inner + suffix + element.value.slice(end),
        selectionStart: start + prefix.length,
        selectionEnd: start + prefix.length + inner.length,
      };
    });
  }

  function block(prefix: string) {
    apply((element) =>
      formatMarkdownBlock(element.value, element.selectionStart, element.selectionEnd, prefix),
    );
  }

  return {
    insertBold: () => inline("**", "**"),
    insertItalic: () => inline("*", "*"),
    insertH1: () => block("# "),
    insertH2: () => block("## "),
    insertBulletList: () => block("- "),
    insertCode: () => inline("`", "`"),
    insertLink: () => inline("[", "](url)"),
  };
}
