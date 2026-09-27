import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { checkFreshness, compareSources } from "./freshness.mjs";
import { fetchUpstream } from "./remote.mjs";
import { SOURCE_PATHS } from "./source.mjs";

const dir = new URL("../../packages/types/data/copilot-pricing/", import.meta.url);
const read = (file) => readFileSync(new URL(file, dir), "utf8").replaceAll("\r\n", "\n");
const local = {
  snapshot: JSON.parse(read("snapshot.json")),
  policy: JSON.parse(read("policy.json")),
  sources: {
    usage: read("models-and-pricing.yml"),
    annual: read("annual-subscriber-model-multipliers.yml"),
  },
};
const upstream = {
  snapshot: structuredClone(local.snapshot),
  sources: structuredClone(local.sources),
};
const today = "2026-09-27";
const latestSha = "b".repeat(40);

function remote(sources = local.sources) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === "https://api.github.com/repos/github/docs/commits/main")
      return { ok: true, json: async () => ({ sha: latestSha }) };
    const source = Object.entries(SOURCE_PATHS).find(([, path]) => url.endsWith(`/${path}`))?.[0];
    const page = Object.entries(local.snapshot.footnotes)
      .map(([key, text]) => `[^${key}]: ${text}`)
      .join("\n");
    return { ok: true, text: async () => (source === "page" ? page : sources[source]) };
  };
  return { calls, fetchImpl };
}

test("fetch automatically resolves main once and pins every download to it", async () => {
  const mock = remote();
  const result = await fetchUpstream({
    fetchImpl: mock.fetchImpl,
    token: "test-token",
    verifiedAt: today,
  });
  assert.equal(result.snapshot.revision, latestSha);
  assert.equal(mock.calls.length, 4);
  assert.equal(mock.calls[0].options.headers.Authorization, "Bearer test-token");
  for (const call of mock.calls.slice(1)) {
    assert.ok(call.url.startsWith(`https://raw.githubusercontent.com/github/docs/${latestSha}/`));
    assert.equal(call.options.headers?.Authorization, undefined);
  }
  assert.deepEqual(result.snapshot.footnotes, local.snapshot.footnotes);
});

test("explicit revision remains available for replay and date defaults to UTC today", async () => {
  const mock = remote();
  const before = new Date().toISOString().slice(0, 10);
  const result = await fetchUpstream({ fetchImpl: mock.fetchImpl, revision: latestSha });
  assert.ok([before, new Date().toISOString().slice(0, 10)].includes(result.snapshot.verifiedAt));
  assert.equal(mock.calls.length, 3);
  await assert.rejects(
    () => fetchUpstream({ revision: "main", fetchImpl: mock.fetchImpl }),
    /full.*SHA/,
  );
});

test("unchanged pricing at a newer commit is current, ignoring ordering, YAML comments and price spelling", async () => {
  const values = parse(local.sources.usage).reverse();
  values[0].category = "New marketing category";
  values[0].release_status = "Public preview";
  values.find((row) => row.input === "$4.00").input = "$4";
  const mock = remote({ ...local.sources, usage: `# Comment changed\n${stringify(values)}` });
  const report = await checkFreshness(local, { fetchImpl: mock.fetchImpl, verifiedAt: today });
  assert.equal(report.status, "current");
  assert.equal(report.upstreamRevision, latestSha);
  assert.deepEqual(report.changes, []);
});

test("both short and long-context rate changes and thresholds are detected", () => {
  for (const tier of ["Default", "Long context"]) {
    for (const field of ["input", "cached_input", "cache_write", "output", "threshold"]) {
      const changed = structuredClone(upstream);
      const values = parse(changed.sources.usage);
      const row = values.find((item) => item.model === "GPT-6 Sol" && item.tier === tier);
      row[field] = field === "threshold" ? `${tier === "Default" ? "≤" : ">"} 300K` : "$123.45";
      changed.sources.usage = stringify(values);
      const differences = compareSources(local, changed, today);
      assert.equal(differences.length, 1);
      assert.equal(differences[0].key, `GPT-6 Sol / ${tier}`);
      assert.match(differences[0].after, new RegExp(field));
    }
  }
});

test("new unknown models, removed tiers, annual multipliers and footnotes trigger an advisory", () => {
  const changed = structuredClone(upstream);
  const values = parse(changed.sources.usage);
  values.push({ ...values[0], model: "Future unknown model" });
  changed.sources.usage = stringify(
    values.filter((row) => !(row.model === "GPT-6 Luna" && row.tier === "Long context")),
  );
  const annual = parse(changed.sources.annual);
  annual[0].new_multiplier = "10";
  changed.sources.annual = stringify(annual);
  changed.snapshot.footnotes["gemini-flash-promo"] += " New conditions.";
  const differences = compareSources(local, changed, today);
  assert.equal(differences.length, 4);
  assert.ok(differences.some((row) => row.kind === "added" && row.key.includes("Future unknown")));
  assert.ok(differences.some((row) => row.kind === "removed" && row.key.includes("Long context")));
  assert.ok(differences.some((row) => row.table === "annual"));
  assert.ok(differences.some((row) => row.table === "footnotes"));
});

test("an expired saved promotion needs review even if upstream has not been updated", () => {
  assert.ok(compareSources(local, upstream, "2027-01-01").some((row) => row.table === "expiry"));
});

test("network, rate limits, malformed source and corrupted snapshots are unavailable, never current", async () => {
  for (const fetchImpl of [
    async () => {
      throw new Error("network timeout");
    },
    async () => ({ ok: false, status: 429 }),
    remote({ ...local.sources, usage: "<html>unavailable</html>" }).fetchImpl,
  ]) {
    const report = await checkFreshness(local, { fetchImpl, verifiedAt: today });
    assert.equal(report.status, "unavailable");
    assert.match(report.error, /Could not verify/);
  }
  const corrupted = structuredClone(local);
  corrupted.sources.usage += "\n";
  assert.equal(
    (await checkFreshness(corrupted, { fetchImpl: remote().fetchImpl, verifiedAt: today })).status,
    "unavailable",
  );
});

test("freshness workflow is advisory and the publisher executes trusted code only", () => {
  const workflow = (name) =>
    parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
  const check = workflow("pricing-freshness");
  assert.deepEqual(check.permissions, { contents: "read" });
  assert.equal(check.jobs.freshness["continue-on-error"], true);
  const publish = workflow("pricing-report");
  const checkout = publish.jobs.report.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
  assert.equal(checkout.with.ref, "${{ github.event.repository.default_branch }}");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.ok(
    !publish.jobs.report.steps.some((step) => /(?:pnpm|npm) (?:install|ci)/.test(step.run ?? "")),
  );
});
