/**
 * Checkpoint content parser — detects and extracts structured sections
 * from checkpoint markdown files that follow the XML-like schema used
 * by Copilot CLI compaction summaries.
 *
 * Known sections: `<overview>`, `<history>`, `<work_done>`,
 * `<technical_details>`, `<next_steps>`.
 */

export interface CheckpointSections {
  overview: string;
  history?: string;
  workDone?: string;
  technicalDetails?: string;
  nextSteps?: string;
}

const SECTION_TAGS = [
  "overview",
  "history",
  "work_done",
  "technical_details",
  "next_steps",
] as const;

type SectionTag = (typeof SECTION_TAGS)[number];

/** Map wire tag names to CheckpointSections keys. */
const TAG_TO_KEY: Record<SectionTag, keyof CheckpointSections> = {
  overview: "overview",
  history: "history",
  work_done: "workDone",
  technical_details: "technicalDetails",
  next_steps: "nextSteps",
};

/**
 * Extract the text between `<tag>` and `</tag>`, where both tags must appear
 * on their own line (start-of-line). This prevents false matches on inline
 * mentions like `` `<overview>` `` inside the content body.
 */
function extractTag(content: string, tag: string): string | undefined {
  const openRe = new RegExp(`^<${tag}>\\s*$`, "m");
  const closeRe = new RegExp(`^</${tag}>\\s*$`, "m");
  const openMatch = openRe.exec(content);
  if (!openMatch) return undefined;
  const startIdx = openMatch.index + openMatch[0].length;
  const closeMatch = closeRe.exec(content.slice(startIdx));
  if (!closeMatch) return undefined;
  return content.slice(startIdx, startIdx + closeMatch.index).trim();
}

/**
 * Returns true if the content matches the structured checkpoint schema
 * (at minimum, a line-level `<overview>` section must be present).
 */
export function isStructuredCheckpoint(content: string): boolean {
  return /^<overview>\s*$/m.test(content) && /^<\/overview>\s*$/m.test(content);
}

/**
 * Parse structured sections from checkpoint content.
 * Returns `null` if the content doesn't match the schema.
 */
export function parseCheckpointSections(content: string): CheckpointSections | null {
  if (!isStructuredCheckpoint(content)) return null;

  const overview = extractTag(content, "overview");
  if (overview == null) return null;

  const sections: CheckpointSections = { overview };

  for (const tag of SECTION_TAGS) {
    if (tag === "overview") continue;
    const value = extractTag(content, tag);
    if (value != null) {
      sections[TAG_TO_KEY[tag]] = value;
    }
  }

  return sections;
}

/** Section metadata for rendering. */
export interface SectionMeta {
  key: keyof CheckpointSections;
  label: string;
  icon: string;
  /** Whether this section should be expanded by default. */
  defaultExpanded: boolean;
}

/** Ordered list of section definitions for rendering. */
export const SECTION_DEFS: SectionMeta[] = [
  { key: "overview", label: "Overview", icon: "📋", defaultExpanded: true },
  { key: "history", label: "History", icon: "📜", defaultExpanded: false },
  { key: "workDone", label: "Work Done", icon: "✅", defaultExpanded: false },
  { key: "technicalDetails", label: "Technical Details", icon: "🔧", defaultExpanded: false },
  { key: "nextSteps", label: "Next Steps", icon: "🎯", defaultExpanded: false },
];
