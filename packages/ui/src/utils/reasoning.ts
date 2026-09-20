/**
 * Copilot sometimes prefixes visible reasoning with a standalone bold heading.
 * Treat this as optional presentation metadata, never as a generated summary.
 * Match only the opening line; prose, inline emphasis and incomplete streams
 * keep the generic label. The original content is always left intact.
 */
export function getReasoningSummary(content: string): string | null {
  const firstLine = content.trimStart().split(/\r?\n/, 1)[0];
  const match = /^\*\*([^*\r\n]{1,160})\*\*[\t ]*$/.exec(firstLine);
  const heading = match?.[1].trim();
  // Avoid promoting nested Markdown, links, code or markup into a heading.
  return heading && !/[`_<>[\]\\]/.test(heading) ? heading : null;
}

/** Display body with only the recognized opening heading removed. Stored text is unchanged. */
export function getReasoningBody(content: string): string {
  if (!getReasoningSummary(content)) return content;
  const trimmed = content.trimStart();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return "";
  // Drop blank separator lines, preserving body indentation and later headings.
  return trimmed.slice(newline + 1).replace(/^(?:[\t ]*\r?\n)+/, "");
}
