// Claude Code API-equivalent rates from Anthropic's published pricing page.
// Parsing is strict: any change to the table's shape stops the update instead
// of writing partial or misread prices.
import { isDeepStrictEqual } from "node:util";
import { requireDate } from "./source.mjs";

export const CLAUDE_PRICING_MARKDOWN_URL =
  "https://platform.claude.com/docs/en/about-claude/pricing.md";

const COLUMNS = [
  ["Model", null],
  ["Base input tokens", "inputPerM"],
  ["5m cache writes", "cacheWritePerM"],
  ["1h cache writes", "cacheWrite1hPerM"],
  ["Cache hits and refreshes", "cachedInputPerM"],
  ["Output tokens", "outputPerM"],
];
/** Field order of a written entry, matching the existing JSON. */
const RATE_FIELDS = [
  "inputPerM",
  "cachedInputPerM",
  "cacheWritePerM",
  "cacheWrite1hPerM",
  "outputPerM",
];
const HEADER = COLUMNS.map(([name]) => name);
const STATUS_NOTE = /^(retired|deprecated|limited availability)\b/i;
const TIER_NOTE = /^for prompts (up to|over) (\d{1,3}(?:,\d{3})*) tokens$/;

const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
const stripMarkup = (text) =>
  text
    .replace(/<sup>.*?<\/sup>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();

/** `Claude Haiku 5.5` → `claude-haiku-5.5`; anything else is an error. */
export function claudeModelId(displayName) {
  const match = /^Claude ([A-Z][a-z]+) (\d+(?:\.\d+)?)$/.exec(displayName.trim());
  if (!match) throw new Error(`Cannot map Claude model name: ${displayName}`);
  return `claude-${match[1].toLowerCase()}-${match[2]}`;
}

function parseModelCell(cell) {
  const text = stripMarkup(cell);
  const match = /^(.*?)(?: \((.+)\))?$/.exec(text);
  const model = claudeModelId(match[1]);
  const note = match[2];
  if (note == null || STATUS_NOTE.test(note)) return { model, tier: null };
  const tier = TIER_NOTE.exec(note);
  if (!tier) throw new Error(`Unrecognized qualifier for ${model}: ${note}`);
  const threshold = Number(tier[2].replaceAll(",", ""));
  return { model, tier: tier[1] === "up to" ? { upTo: threshold } : { over: threshold } };
}

function parsePrice(cell, model, column) {
  const text = stripMarkup(cell);
  const match = /^\$(\d+(?:\.\d+)?) \/ MTok$/.exec(text);
  if (!match) throw new Error(`Invalid ${column} price for ${model}: ${cell}`);
  return Number(match[1]);
}

/** Prices that cannot be right mean a column moved or a cell was misread. */
function checkRates(model, rates) {
  const { inputPerM, cachedInputPerM, cacheWritePerM, cacheWrite1hPerM, outputPerM } = rates;
  if (Object.values(rates).some((value) => !(value > 0)))
    throw new Error(`Non-positive price for ${model}`);
  if (
    !(cachedInputPerM < inputPerM && inputPerM < cacheWritePerM) ||
    !(cacheWritePerM < cacheWrite1hPerM && inputPerM < outputPerM)
  )
    throw new Error(`Implausible price ordering for ${model}; check the table columns`);
}

/**
 * The model pricing table of Anthropic's pricing page (Markdown variant) as
 * registry rows: `{ model, pricingTier?, minimumInputTokens?, ...rates }`.
 * Footnote texts are returned for review; footnote markers are dropped.
 */
export function parseClaudePricing(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const heading = lines.findIndex((line) => line.trim() === "## Model pricing");
  if (heading < 0) throw new Error("Missing the Model pricing section");
  const start = lines.findIndex((line, index) => index > heading && line.trim().startsWith("|"));
  const next = lines.findIndex((line, index) => index > heading && /^##? /.test(line));
  if (start < 0 || (next >= 0 && next < start)) throw new Error("Missing the model pricing table");
  let end = start;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  const [header, separator, ...body] = lines.slice(start, end).map(cells);
  if (!isDeepStrictEqual(header, HEADER))
    throw new Error(`Unexpected pricing table columns: ${header.join(" | ")}`);
  if (separator?.length !== COLUMNS.length || !separator.every((cell) => /^:?-+:?$/.test(cell)))
    throw new Error("Malformed pricing table separator");
  if (body.length === 0) throw new Error("Empty pricing table");

  const rows = [];
  const tiers = new Map();
  for (const row of body) {
    if (row.length !== COLUMNS.length) throw new Error(`Unexpected row: ${row.join(" | ")}`);
    const { model, tier } = parseModelCell(row[0]);
    const rates = Object.fromEntries(
      COLUMNS.slice(1).map(([name, field], index) => [
        field,
        parsePrice(row[index + 1], model, name),
      ]),
    );
    checkRates(model, rates);
    const entry = { model };
    if (tier?.over != null) {
      entry.pricingTier = "long-context";
      entry.minimumInputTokens = tier.over + 1;
    }
    for (const field of RATE_FIELDS) entry[field] = rates[field];
    if (rows.some((other) => sameKey(other, entry)))
      throw new Error(`Duplicate pricing row for ${model}`);
    if (tier) tiers.set(model, [...(tiers.get(model) ?? []), tier]);
    else if (rows.some((other) => other.model === model))
      throw new Error(`Mixed tiered and untiered rows for ${model}`);
    rows.push(entry);
  }
  for (const [model, list] of tiers) {
    const upTo = list.find((tier) => tier.upTo != null)?.upTo;
    const over = list.find((tier) => tier.over != null)?.over;
    if (list.length !== 2 || upTo == null || upTo !== over)
      throw new Error(`Incomplete prompt-length tiers for ${model}`);
  }
  const sectionEnd = lines.findIndex((line, index) => index >= end && /^##? /.test(line));
  const footnotes = lines
    .slice(end, sectionEnd < 0 ? undefined : sectionEnd)
    .map((line) => /^\*<sup>(\d+ .+)<\/sup>\*$/.exec(line.trim())?.[1])
    .filter(Boolean);
  return { rows, footnotes };
}

const tierKey = (entry) => `${entry.model}@${entry.minimumInputTokens ?? 0}`;
const sameKey = (a, b) => tierKey(a) === tierKey(b);
export const describeTier = (entry) =>
  entry.minimumInputTokens ? `${entry.model} (${entry.minimumInputTokens}+ tokens)` : entry.model;

/**
 * Applies published rows to `claude-code-pricing-data.json`. Existing entries
 * keep their position and aliases; new rows are appended in page order;
 * entries no longer published are kept and reported as retained.
 */
export function reconcileClaudePricing(data, rows, verifiedAt) {
  requireDate(verifiedAt);
  const changes = [];
  const anthropicUsage = data.anthropicUsage.map((entry) => {
    const row = rows.find((candidate) => sameKey(candidate, entry));
    if (!row) return entry;
    const fields = RATE_FIELDS.filter((field) => entry[field] !== row[field]);
    if (fields.length === 0) return entry;
    changes.push({
      kind: "changed",
      model: describeTier(entry),
      before: Object.fromEntries(fields.map((field) => [field, entry[field] ?? null])),
      after: Object.fromEntries(fields.map((field) => [field, row[field]])),
    });
    return { ...entry, ...Object.fromEntries(fields.map((field) => [field, row[field]])) };
  });
  for (const row of rows) {
    if (data.anthropicUsage.some((entry) => sameKey(entry, row))) continue;
    changes.push({
      kind: "added",
      model: describeTier(row),
      after: Object.fromEntries(RATE_FIELDS.map((field) => [field, row[field]])),
    });
    anthropicUsage.push(row);
  }
  const retained = data.anthropicUsage
    .filter((entry) => !rows.some((row) => sameKey(row, entry)))
    .map(describeTier);
  return {
    data: { ...data, source: { ...data.source, verifiedAt }, anthropicUsage },
    changes,
    retained,
  };
}

export async function fetchClaudePricing({
  url = CLAUDE_PRICING_MARKDOWN_URL,
  fetchImpl = fetch,
} = {}) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  return response.text();
}
