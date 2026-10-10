import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractFootnotes, parseSources, sha256 } from "./source.mjs";
import { updatePricing } from "./update.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replaceAll("\r\n", "\n");
const json = (path) => JSON.parse(read(path));
const dir = "packages/types/data/copilot-pricing/";
const snapshot = json(`${dir}snapshot.json`);
const policy = json(`${dir}policy.json`);
const usage = read(`${dir}models-and-pricing.yml`);
const annual = read(`${dir}annual-subscriber-model-multipliers.yml`);
const data = json("packages/types/src/pricing-data.json");
const models = json("packages/types/data/model-registry.json");
const parse = (text = usage, metadata = snapshot) =>
  parseSources(metadata, text, annual, policy, data, models);
const parsed = parse();
const future = {
  ...snapshot,
  verifiedAt: new Date(Date.parse(snapshot.verifiedAt) + 86_400_000).toISOString().slice(0, 10),
};
const withHash = (text) => ({ ...snapshot, sha256: { ...snapshot.sha256, usage: sha256(text) } });

test("frozen official sources reproduce all shipped rates and Rust/TS defaults without network", () => {
  assert.equal(snapshot.verifiedAt, "2026-10-10");
  assert.equal(parsed.usage.length, 45);
  assert.equal(parsed.annual.length, 16);
  assert.deepEqual(updatePricing(data, models, parsed, snapshot), { data, models });
});

test("a changed rate versions every context tier once and preserves provenance", () => {
  const changed = structuredClone(parsed);
  changed.usage.find((row) => row.model === "gpt-6-sol").inputPerM = 1.5;
  const next = updatePricing(data, models, changed, future);
  const history = next.data.githubCopilotUsageHistory.filter((row) => row.model === "gpt-6-sol");
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((row) => row.inputPerM),
    [2, 4],
  );
  for (const row of history) {
    assert.equal(row.effectiveFrom, "2026-09-27");
    assert.equal(row.verifiedAt, snapshot.verifiedAt);
    assert.equal(row.effectiveTo, future.verifiedAt);
  }
  const current = next.data.githubCopilotUsage.filter((row) => row.model === "gpt-6-sol");
  assert.ok(current.every((row) => row.effectiveFrom === future.verifiedAt));
  assert.equal(next.models.find((model) => model.id === "gpt-6-sol").inputPerM, 1.5);
  assert.deepEqual(updatePricing(next.data, next.models, changed, future), next);
  assert.equal(data.githubCopilotUsage.find((row) => row.model === "gpt-6-sol").inputPerM, 2);
});

test("removed tiers are archived; changed thresholds do not leave stale live tiers", () => {
  for (const operation of ["remove", "threshold"]) {
    const changed = structuredClone(parsed);
    const long = changed.usage.find((row) => row.model === "gpt-6-sol" && row.minimumInputTokens);
    if (operation === "remove") changed.usage = changed.usage.filter((row) => row !== long);
    else long.minimumInputTokens = 300001;
    const next = updatePricing(data, models, changed, future);
    assert.equal(
      next.data.githubCopilotUsageHistory.filter((row) => row.model === "gpt-6-sol").length,
      2,
    );
    assert.ok(
      !next.data.githubCopilotUsage.some(
        (row) => row.model === "gpt-6-sol" && row.minimumInputTokens === 272001,
      ),
    );
  }
});

test("delisted models keep the last verification date and no invented retirement date", () => {
  const changed = { ...parsed, usage: parsed.usage.filter((row) => row.model !== "grok-4.7") };
  const next = updatePricing(data, models, changed, future);
  const retained = next.data.githubCopilotUsage.find((row) => row.model === "grok-4.7");
  assert.equal(retained.verifiedAt, snapshot.verifiedAt);
  assert.ok(retained.sourceNote.includes(`absent from the ${future.verifiedAt} Copilot table`));
  assert.equal(retained.effectiveTo, undefined);
  assert.equal(next.data.githubCopilotUsage.filter((row) => row.model === "grok-4.7").length, 2);
  assert.deepEqual(next.data.githubCopilotUsageHistory, data.githubCopilotUsageHistory);
  assert.deepEqual(next.models, models);
  assert.deepEqual(updatePricing(next.data, next.models, changed, future), next);
});

test("delisted annual multipliers retain billing and compatibility values without inventing an end date", () => {
  const changed = {
    ...parsed,
    annual: parsed.annual.filter((row) => row.model !== "claude-opus-4.8"),
  };
  const next = updatePricing(data, models, changed, future);
  const old = data.annualLegacyMultipliers.find((row) => row.model === "claude-opus-4.8");
  const retained = next.data.annualLegacyMultipliers.find((row) => row.model === old.model);
  assert.deepEqual(retained, {
    ...old,
    verifiedAt: snapshot.verifiedAt,
    sourceNote: `Retained ${snapshot.verifiedAt} snapshot; absent from the ${future.verifiedAt} Copilot table`,
  });
  assert.equal(retained.effectiveTo, undefined);
  assert.deepEqual(next.data.annualLegacyMultiplierHistory, data.annualLegacyMultiplierHistory);
  assert.deepEqual(next.models, models);
  assert.deepEqual(updatePricing(next.data, next.models, changed, future), next);
});

test("annual multiplier changes retain history without rewriting local compatibility values", () => {
  const changed = structuredClone(parsed);
  changed.annual.find((row) => row.model === "gpt-5.5").premiumRequests = 60;
  const next = updatePricing(data, models, changed, future);
  assert.equal(
    next.data.annualLegacyMultiplierHistory.find((row) => row.model === "gpt-5.5").premiumRequests,
    57,
  );
  assert.equal(
    next.data.annualLegacyMultipliers.find((row) => row.model === "gpt-5.5").currentPremiumRequests,
    7.5,
  );
  assert.equal(next.models.find((model) => model.id === "gpt-5.5").premiumRequests, 7.5);
});

test("snapshot dates cannot silently rewrite existing history", () => {
  assert.throws(
    () => updatePricing(data, models, parsed, { ...snapshot, verifiedAt: "2026-09-01" }),
    /backwards/,
  );
  const changed = structuredClone(parsed);
  changed.usage.find((row) => row.model === "gpt-6.1-sol").inputPerM = 1.5;
  const next = updatePricing(data, models, changed, future);
  changed.usage.find((row) => row.model === "gpt-6.1-sol").inputPerM = 1;
  assert.throws(() => updatePricing(next.data, next.models, changed, future), /Cannot rewrite/);
});

test("source digests and explicit footnote review prevent silent source drift", () => {
  assert.throws(() => parse(`${usage}\n`), /hash mismatch/);
  assert.throws(() => parse(usage, { ...snapshot, footnotes: {} }), /footnote/);
  assert.throws(() => parse(usage, { ...snapshot, verifiedAt: "2027-01-01" }), /Expired/);
  assert.throws(() => parse(usage, { ...snapshot, verifiedAt: "2026-02-30" }), /ISO calendar/);
  assert.throws(() => parse(usage, { ...snapshot, verifiedAt: "2026-13-01" }), /ISO calendar/);
  assert.deepEqual(
    extractFootnotes("[^promo]: First line\n    Changed conditions\n\nAnother paragraph"),
    {
      promo: "First line\n    Changed conditions",
    },
  );
});

test("delisting a promotional model preserves both its expiry and retention note", () => {
  const changed = {
    ...parsed,
    usage: parsed.usage.filter((row) => row.model !== "gemini-3.8-flash"),
  };
  const next = updatePricing(data, models, changed, future);
  const retained = next.data.githubCopilotUsage.find((row) => row.model === "gemini-3.8-flash");
  assert.equal(retained.effectiveTo, "2027-01-01");
  assert.match(retained.sourceNote, /Promotional Copilot rates.*absent from/);
  assert.deepEqual(updatePricing(next.data, next.models, changed, future), next);
});

test("shared metadata price drift is corrected without adding pricing history", () => {
  const drifted = structuredClone(models);
  drifted.find((model) => model.id === "gpt-6-luna").inputPerM = 10;
  const next = updatePricing(data, drifted, parsed, snapshot);
  assert.deepEqual(next, { data, models });
});

test("malformed prices, columns, identities and incomplete tiers fail closed", () => {
  for (const [from, to, error] of [
    ["input: $0.25", "input: $-1", /Invalid USD/],
    ["input: $0.25", "input: Not applicable", /Invalid USD/],
    ["input: $0.25", "input: NaN", /Invalid USD/],
    ["cached_input: $0.025", "unexpected: $0.025", /Unreviewed source column/],
    ["cache_write: Not applicable", "", /Invalid USD/],
    ["GPT-5 mini", "GPT-unknown", /Register exactly one/],
    ["> 272K", "> 300K", /Incomplete\/inconsistent/],
    ["≤ 272K", "< 272K", /Unrecognized tier/],
  ]) {
    const modified = usage.replace(from, to);
    assert.notEqual(modified, usage);
    assert.throws(() => parse(modified, withHash(modified)), error);
  }
  const duplicate = `${usage}\n${usage}`;
  assert.throws(() => parse(duplicate, withHash(duplicate)), /Incomplete\/inconsistent|Duplicate/);
});
