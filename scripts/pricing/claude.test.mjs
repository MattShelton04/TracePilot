import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claudeModelId,
  fetchClaudePricing,
  parseClaudePricing,
  reconcileClaudePricing,
} from "./claude.mjs";

// A trimmed, synthetic excerpt in the page's Markdown shape (not real prices).
const HEADER =
  "| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |";
const page = (rows, header = HEADER) =>
  [
    "---",
    "title: Pricing",
    "---",
    "",
    "## Model pricing",
    "",
    "The following table shows pricing for all Claude models:",
    "",
    header,
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...rows,
    "",
    "*<sup>1 Cache hits on Claude Alpha 2 use a 0.05x multiplier.</sup>*",
    "",
    "## Cloud platform pricing",
    "",
    "| Model | Input |",
    "| --- | --- |",
    "| Claude Alpha 2 | $99 / MTok |",
  ].join("\n");
const ROWS = [
  "| Claude Alpha 2 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok<sup>1</sup> | $20 / MTok |",
  "| Claude Beta 1.5 ([retired, except on Google Cloud](https://example.test/x)) | $3 / MTok | $3.75 / MTok | $6 / MTok | $0.30 / MTok | $15 / MTok |",
  "| Claude Gamma 3.5 (for prompts up to 10,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |",
  "| Claude Gamma 3.5 (for prompts over 10,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |",
];
const rates = (input, cached, write, hour, output) => ({
  inputPerM: input,
  cachedInputPerM: cached,
  cacheWritePerM: write,
  cacheWrite1hPerM: hour,
  outputPerM: output,
});

test("maps display names to registry ids and rejects anything else", () => {
  assert.equal(claudeModelId("Claude Haiku 5.5"), "claude-haiku-5.5");
  assert.equal(claudeModelId("Claude Opus 5"), "claude-opus-5");
  assert.equal(claudeModelId(" Claude Fable 5.1 "), "claude-fable-5.1");
  for (const name of ["Claude Mythos Preview", "Haiku 5.5", "Claude Opus 5.5 Fast", "GPT-6"])
    assert.throws(() => claudeModelId(name), /Cannot map Claude model name/);
});

test("parses the model table with status notes, footnote markers and prompt tiers", () => {
  const { rows, footnotes } = parseClaudePricing(page(ROWS).replaceAll("\n", "\r\n"));
  assert.deepEqual(rows, [
    { model: "claude-alpha-2", ...rates(4, 0.2, 5, 8, 20) },
    { model: "claude-beta-1.5", ...rates(3, 0.3, 3.75, 6, 15) },
    { model: "claude-gamma-3.5", ...rates(0.1, 0.01, 0.125, 0.2, 0.5) },
    {
      model: "claude-gamma-3.5",
      pricingTier: "long-context",
      minimumInputTokens: 10_001,
      ...rates(0.5, 0.05, 0.625, 1, 2.5),
    },
  ]);
  assert.deepEqual(footnotes, ["1 Cache hits on Claude Alpha 2 use a 0.05x multiplier."]);
});

test("stops on a changed table shape instead of returning partial prices", () => {
  const cases = [
    [page(ROWS, HEADER.replace("1h cache writes", "Cache writes")), /Unexpected pricing table/],
    [page(ROWS).replace("## Model pricing", "## Prices"), /Missing the Model pricing section/],
    [page([ROWS[0].replace("$5 / MTok", "$5 per MTok")]), /Invalid 5m cache writes price/],
    [page([ROWS[0].replace("| $20 / MTok |", "| $20 / MTok | $1 / MTok |")]), /Unexpected row/],
    [page([ROWS[0].replace("Claude Alpha 2", "Claude Alpha 2 (batch only)")]), /qualifier/],
    [page([ROWS[0], ROWS[0]]), /Duplicate pricing row/],
    [page([ROWS[2]]), /Incomplete prompt-length tiers/],
    [page([ROWS[2], ROWS[3].replace("over 10,000", "over 20,000")]), /Incomplete/],
    // Swapped columns (output in the input column) fail the plausibility check.
    [page([ROWS[0].replace("$4 / MTok", "$40 / MTok")]), /Implausible price ordering/],
    [page([ROWS[0].replace("$4 / MTok", "$0 / MTok")]), /Non-positive/],
    [page([]), /Empty pricing table/],
  ];
  for (const [markdown, error] of cases) assert.throws(() => parseClaudePricing(markdown), error);
});

test("reconciles changes, appends new tiers and keeps unpublished models", () => {
  const data = {
    source: { label: "Anthropic", url: "https://example.test/pricing", verifiedAt: "2026-01-01" },
    anthropicUsage: [
      { model: "claude-beta-1.5", aliases: ["claude-1-5-beta"], ...rates(3, 0.3, 3.75, 6, 15) },
      { model: "claude-alpha-2", ...rates(4, 0.4, 5, 8, 20) },
      { model: "claude-old-1", ...rates(15, 1.5, 18.75, 30, 75) },
    ],
  };
  const { rows } = parseClaudePricing(page(ROWS));
  const result = reconcileClaudePricing(data, rows, "2026-10-11");
  assert.equal(result.data.source.verifiedAt, "2026-10-11");
  assert.equal(result.data.source.url, data.source.url);
  assert.deepEqual(
    result.data.anthropicUsage.map((entry) => [entry.model, entry.minimumInputTokens ?? 0]),
    [
      ["claude-beta-1.5", 0],
      ["claude-alpha-2", 0],
      ["claude-old-1", 0],
      ["claude-gamma-3.5", 0],
      ["claude-gamma-3.5", 10_001],
    ],
  );
  assert.deepEqual(result.data.anthropicUsage[0].aliases, ["claude-1-5-beta"]);
  assert.deepEqual(result.changes, [
    {
      kind: "changed",
      model: "claude-alpha-2",
      before: { cachedInputPerM: 0.4 },
      after: { cachedInputPerM: 0.2 },
    },
    { kind: "added", model: "claude-gamma-3.5", after: rates(0.1, 0.01, 0.125, 0.2, 0.5) },
    {
      kind: "added",
      model: "claude-gamma-3.5 (10001+ tokens)",
      after: rates(0.5, 0.05, 0.625, 1, 2.5),
    },
  ]);
  assert.deepEqual(result.retained, ["claude-old-1"]);
  assert.equal(data.anthropicUsage[1].cachedInputPerM, 0.4, "input data is not mutated");

  const again = reconcileClaudePricing(result.data, rows, "2026-10-11");
  assert.deepEqual(again.changes, []);
  assert.deepEqual(again.data, result.data);
  assert.throws(() => reconcileClaudePricing(data, rows, "2026-13-01"), /ISO calendar date/);
});

test("fetch reports HTTP failures and returns the page text", async () => {
  const calls = [];
  const ok = async (url) => {
    calls.push(url);
    return { ok: true, text: async () => "markdown" };
  };
  assert.equal(await fetchClaudePricing({ fetchImpl: ok }), "markdown");
  assert.match(calls[0], /^https:\/\/platform\.claude\.com\/docs\/.+\/pricing\.md$/);
  await assert.rejects(
    fetchClaudePricing({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/,
  );
});
