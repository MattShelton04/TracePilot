// Build-time data. Both JSON files are generated (git-ignored) by
// scripts/export-data.mjs and scripts/release-data.mjs before every dev/build run.
import release from "./data/release.json";
import showcase from "./data/showcase.json";

/** The README showcase workspace (scripts/visual/showcase), plus derived costs and counts. */
export const D = showcase;
/** The latest published release (version, release page, Windows installer). */
export const R = release;
export const VERSION = release.version;
export const DOWNLOAD_URL = release.installer ? release.installer.url : release.page;

/*
 * Agent usage for the Agents views. The showcase fixtures do not model agent
 * definitions or cross-session run statistics, so these figures are
 * illustrative; totals shown on the page are summed from this list.
 */
export const AGENT_RUNS = [
  {
    type: "explore",
    name: "Explore Agent",
    description: "Fast codebase exploration and answering questions. Safe to call in parallel.",
    runs: 412,
    median: "38s",
    failed: 0.01,
    tags: ["Built-in", "Model mismatch", "Slower"],
    seed: 11,
  },
  {
    type: "general-purpose",
    name: "General Purpose Agent",
    description: "Full-capability agent running in a subprocess.",
    runs: 318,
    median: "2m 22s",
    failed: 0.031,
    tags: ["Built-in", "Slower"],
    seed: 23,
  },
  {
    type: "code-review",
    name: "Code Review Agent",
    description: "Reviews changes with a high signal-to-noise ratio.",
    runs: 96,
    median: "2m 36s",
    failed: 0.16,
    tags: ["Built-in", "Failing", "Slower"],
    seed: 37,
  },
  {
    type: "task",
    name: "Task Agent",
    description: "Runs commands and reports results.",
    runs: 44,
    median: "21s",
    failed: 0.045,
    tags: ["Built-in", "Slower"],
    seed: 41,
  },
  {
    type: "rubber-duck",
    name: "Rubber Duck",
    description: "A second opinion from a complementary model.",
    runs: 12,
    median: "1m 4s",
    failed: 0.083,
    tags: ["Built-in", "Slower"],
    seed: 53,
  },
  {
    type: "legacy-helper",
    name: "",
    description: "Old in-house helper (removed)",
    runs: 6,
    median: "1m 30s",
    failed: 0.5,
    tags: ["Unresolved"],
    seed: 61,
  },
];
