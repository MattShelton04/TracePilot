/**
 * Copilot sometimes prefixes visible reasoning with a standalone bold heading,
 * and one message can hold several such chains of thought. Treat headings as
 * optional presentation metadata, never as a generated summary. A message
 * must open with a heading before any later ones count, so prose, inline
 * emphasis and incomplete streams keep the generic label. The original
 * content is always left intact.
 */

const HEADING_LINE = /^\*\*([^*\r\n]{1,160})\*\*[\t ]*$/;
const FENCE = /^[\t ]*(```|~~~)/;

/** The heading on one line, or `null` for anything else. */
function headingOf(line: string): string | null {
  const heading = HEADING_LINE.exec(line.replace(/\r?\n$/, ""))?.[1].trim();
  // Avoid promoting nested Markdown, links, code or markup into a heading.
  return heading && !/[`_<>[\]\\]/.test(heading) ? heading : null;
}

export interface ReasoningSection {
  /** The standalone heading that opened the section, if any. */
  heading: string | null;
  /** Section text with the heading line and leading blank lines removed. */
  body: string;
}

const stripLeadingBlankLines = (text: string) => text.replace(/^(?:[\t ]*\r?\n)+/, "");

/**
 * Split reasoning into the chains of thought its standalone headings open.
 * Without an opening heading the whole text is one untitled section; headings
 * inside code fences never start a section.
 */
export function getReasoningSections(content: string): ReasoningSection[] {
  const trimmed = content.trimStart();
  const lines = trimmed.split(/(?<=\n)/);
  if (!headingOf(lines[0] ?? "")) return [{ heading: null, body: content }];

  const sections: { heading: string; lines: string[] }[] = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const heading = inFence ? null : headingOf(line);
    if (heading) sections.push({ heading, lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections.map((section, index) => {
    const body = stripLeadingBlankLines(section.lines.join(""));
    // Later sections render below their own heading, so the gap before the
    // next heading is layout rather than content.
    return {
      heading: section.heading,
      body: index < sections.length - 1 ? body.trimEnd() : body,
    };
  });
}

/** Every heading in the message, in order and without repeats. */
export function getReasoningHeadings(content: string): string[] {
  const headings = getReasoningSections(content)
    .map((section) => section.heading)
    .filter((heading): heading is string => heading !== null);
  return [...new Set(headings)];
}

/** Preview text for one message: its headings joined with commas. */
export function getReasoningSummary(content: string): string | null {
  const headings = getReasoningHeadings(content);
  return headings.length ? headings.join(", ") : null;
}
