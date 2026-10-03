/* ---------------- Detail dialog ---------------- */
// demo: a step id the live demo can play; tiles without one link to the download.
export const INFO = {
  analytics: {
    icon: "chart",
    title: "Analytics",
    lede: "Tokens, AI Credits, cache behaviour and incidents across every session, by day, repository and model.",
    points: [
      "Totals for sessions, tokens, AI Credits and the USD equivalent, filtered by repository and date range",
      "API duration percentiles, turns per session and tool calls per turn",
      "Token usage and activity over time, so a heavy week stands out",
    ],
  },
  agents: {
    icon: "bot",
    title: "Agents",
    lede: "Built-in, personal and project agents, plus the ones that only ever appear in sessions.",
    points: [
      "Runs, median duration and failure rate for every agent",
      "A definition editor that shows the effective configuration",
      "/subagents model overrides in one place",
    ],
  },
  skills: {
    icon: "zap",
    title: "Skills",
    lede: "What is installed, what actually gets used, and what each skill costs in context.",
    points: [
      "Uses, sessions and tokens injected per use",
      "Unused, dormant, drifted and shadowed skills are flagged",
      "Create, edit, or import skills from GitHub",
    ],
  },
  todos: {
    icon: "list",
    title: "Todos",
    lede: "Copilot's plan for a session, as a list or as a dependency graph.",
    points: [
      "Done, in progress, pending and blocked, with the reason a task is blocked",
      "Dependency edges show what had to finish first",
      "Progress for the whole session at a glance",
    ],
    demo: "todos",
  },
  search: {
    icon: "search",
    title: "Search",
    lede: "Full-text search over every prompt, reply, reasoning block and tool result you have.",
    points: [
      "A SQLite FTS5 index on your disk answers in milliseconds",
      "Phrase, prefix, type:, repo: and tool: syntax",
      "Facets by content type, repository, tool and date, then jump to the exact turn",
    ],
    demo: "search",
  },
  tools: {
    icon: "wrench",
    title: "Tool analysis",
    lede: "Which tools run, how often they fail, and how long they take.",
    points: [
      "Call counts and success rates per tool",
      "Failures by tool, so a flaky command stands out",
      "Durations that show where a session spent its time",
    ],
  },
  models: {
    icon: "network",
    title: "Model comparison",
    lede: "How each model you use compares on tokens, credits and cache behaviour.",
    points: [
      "Share of tokens and AI Credits per model",
      "Cache reads per model, so you can see which prompts stay warm",
      "Side-by-side numbers per session or per turn",
    ],
  },
  code: {
    icon: "code",
    title: "Code impact",
    lede: "What your sessions changed: lines, file types, and the files touched most.",
    points: [
      "Lines added and removed across all sessions",
      "Modifications by file type",
      "The most-modified files, so hotspots are obvious",
    ],
  },
  explorer: {
    icon: "folder",
    title: "Explorer",
    lede: "Every file in a session's state directory, with a viewer for each.",
    points: [
      "Markdown, JSON and JSONL, CSV, SQLite and images",
      "plan.md, checkpoints and the raw events.jsonl",
      "Useful when you need to see exactly what the CLI wrote",
    ],
  },
};
