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
