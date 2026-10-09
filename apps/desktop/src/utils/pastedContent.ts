/**
 * Claude Code wraps text the user pasted into a prompt in
 * `<pasted_content id="N">` … `</pasted_content id="N">`. Split a prompt into
 * typed text and pasted blocks so each can be shown for what it is.
 */

export interface PromptPart {
  kind: "text" | "pasted";
  text: string;
}

const PASTED =
  /<pasted_content(?: id="([^"\n]*)")?>\n?([\s\S]*?)\n?<\/pasted_content(?: id="\1")?>/g;

/** Typed text and pasted blocks in order; whitespace-only text is dropped. */
export function splitPastedContent(content: string): PromptPart[] {
  const parts: PromptPart[] = [];
  const pushText = (text: string) => {
    if (text.trim()) parts.push({ kind: "text", text: text.trim() });
  };
  let last = 0;
  for (const match of content.matchAll(PASTED)) {
    pushText(content.slice(last, match.index));
    parts.push({ kind: "pasted", text: match[2] });
    last = match.index + match[0].length;
  }
  if (last === 0) return [{ kind: "text", text: content }];
  pushText(content.slice(last));
  return parts;
}
