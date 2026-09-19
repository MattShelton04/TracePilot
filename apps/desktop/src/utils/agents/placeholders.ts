/**
 * `{{placeholders}}` in built-in agent prompts, resolved where the value is
 * stable. Others (e.g. `{{copilot:memories}}`) are filled at runtime.
 */
const KNOWN_VALUES: Readonly<Record<string, string>> = {
  grepToolName: "grep",
  globToolName: "glob",
  shellToolName: "bash / powershell",
  viewToolName: "view",
};

const PLACEHOLDER = /\{\{\s*([\w:.-]+)\s*\}\}/g;

export interface PromptPlaceholder {
  name: string;
  resolved: string | null;
  count: number;
}

export function findPlaceholders(text: string): PromptPlaceholder[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(PLACEHOLDER)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({
    name,
    resolved: KNOWN_VALUES[name] ?? null,
    count,
  }));
}

/**
 * Markdown for the preview: outside code, placeholders become inline code
 * (the resolved value, or the placeholder itself); inside code they are
 * replaced with plain text so fences stay intact.
 */
export function renderPromptPreview(text: string): string {
  // Fenced blocks and inline code spans are kept apart from prose.
  const segments = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((segment, index) => {
      const isCode = index % 2 === 1;
      return segment.replace(PLACEHOLDER, (whole, name: string) => {
        const resolved = KNOWN_VALUES[name];
        if (isCode) return resolved ?? whole;
        return `\`${resolved ?? whole}\``;
      });
    })
    .join("");
}
