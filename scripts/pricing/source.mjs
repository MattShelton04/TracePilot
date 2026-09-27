import { createHash } from "node:crypto";
import { parse } from "yaml";

export const SOURCE_PATHS = {
  usage: "data/tables/copilot/models-and-pricing.yml",
  annual: "data/tables/copilot/annual-subscriber-model-multipliers.yml",
  page: "content/copilot/reference/copilot-billing/models-and-pricing.md",
};
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
export const normalize = (name) =>
  name
    .trim()
    .replace(/[_\s]+/g, "-")
    .toLowerCase();

export function requireDate(date) {
  const time = Date.parse(date);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
    !Number.isFinite(time) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Expected an ISO calendar date, got ${date}`);
  }
}

export function extractFootnotes(page) {
  return Object.fromEntries(
    [...page.matchAll(/^\[\^([^\]]+)\]: (.+(?:\n[ \t]+.+)*)/gm)].map((match) => [
      match[1],
      match[2].trim(),
    ]),
  );
}

function table(text, fields) {
  const rows = parse(text, { uniqueKeys: true });
  if (!Array.isArray(rows) || !rows.length) throw new Error("Empty or invalid pricing table");
  for (const row of rows) {
    if (!row || typeof row.model !== "string") throw new Error("Missing model name");
    for (const field of Object.keys(row)) {
      if (!fields.includes(field)) throw new Error(`Unreviewed source column: ${field}`);
    }
  }
  return rows;
}

function price(value, optional = false) {
  if (optional && value === undefined) return 0;
  if (typeof value !== "string" || !/^\$\d+(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid USD token price: ${value}`);
  }
  const number = Number(value.slice(1));
  if (!Number.isFinite(number)) throw new Error(`Non-finite price: ${value}`);
  return number;
}

function identity(name, data, models) {
  const identities = [
    ...new Set([...models.map((model) => model.id), ...Object.keys(data.aliases)]),
  ];
  const matches = identities.filter((id) =>
    [id, models.find((model) => model.id === id)?.name, ...(data.aliases[id] ?? [])]
      .filter(Boolean)
      .some((alias) => normalize(alias) === normalize(name)),
  );
  if (matches.length !== 1) {
    throw new Error(`Register exactly one model ID/alias for ${name} before updating prices`);
  }
  return matches[0];
}

export function parseSources(snapshot, usageText, annualText, policy, data, models) {
  requireDate(snapshot.verifiedAt);
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision))
    throw new Error("Expected a full github/docs commit SHA");
  for (const [key, text] of [
    ["usage", usageText],
    ["annual", annualText],
  ]) {
    if (snapshot.sha256[key] !== sha256(text)) throw new Error(`Source hash mismatch: ${key}`);
  }
  const usage = table(usageText, [
    "model",
    "provider",
    "release_status",
    "category",
    "threshold",
    "tier",
    "input",
    "cached_input",
    "cache_write",
    "output",
  ]).map((row) => {
    if (
      !["openai", "anthropic", "google", "xai", "github", "microsoft", "moonshot_ai"].includes(
        row.provider,
      )
    ) {
      throw new Error(`Review unknown provider: ${row.provider}`);
    }
    const notes = [...row.model.matchAll(/\[\^([^\]]+)\]/g)].map((match) => match[1]);
    if (notes.length > 1) throw new Error(`Review multiple footnotes for ${row.model}`);
    const displayName = row.model.replace(/\[\^[^\]]+\]/g, "").trim();
    const model = identity(displayName, data, models);
    if (!models.some((item) => item.id === model))
      throw new Error(`Register model metadata for ${model}`);
    const entry = {
      model,
      displayName,
      inputPerM: price(row.input),
      cachedInputPerM: price(row.cached_input),
      cacheWritePerM:
        row.cache_write === "Not applicable"
          ? 0
          : price(row.cache_write, !["openai", "anthropic"].includes(row.provider)),
      outputPerM: price(row.output),
    };
    if (row.tier === "Long context") {
      const threshold = /^> (\d+)K$/.exec(row.threshold ?? "");
      if (!threshold) throw new Error(`Unrecognized long-context threshold for ${model}`);
      entry.pricingTier = "long-context";
      entry.minimumInputTokens = Number(threshold[1]) * 1000 + 1;
      if (!Number.isSafeInteger(entry.minimumInputTokens)) throw new Error("Unsafe threshold");
    } else if (
      (row.tier !== undefined && row.tier !== "Default") ||
      (row.threshold !== undefined &&
        row.threshold !== "Not applicable" &&
        !/^≤ \d+K$/.test(row.threshold))
    ) {
      throw new Error(`Unrecognized tier/threshold for ${model}`);
    }
    if (notes.length) {
      const note = policy.footnotes[notes[0]];
      if (!note || note.text !== snapshot.footnotes[notes[0]]) {
        throw new Error(`Review changed/unknown pricing footnote: ${notes[0]}`);
      }
      requireDate(note.effectiveTo);
      if (note.effectiveTo <= snapshot.verifiedAt)
        throw new Error("Expired promotional rate in source");
      entry.effectiveTo = note.effectiveTo;
      entry.sourceNote = note.sourceNote;
    }
    return { entry, threshold: row.threshold };
  });
  for (const { entry, threshold } of usage) {
    if (entry.pricingTier === "long-context") continue;
    const long = usage.filter((item) => item.entry.model === entry.model && item.entry.pricingTier);
    const match = /^≤ (\d+)K$/.exec(threshold ?? "");
    if (
      (match &&
        (long.length !== 1 || long[0].entry.minimumInputTokens !== Number(match[1]) * 1000 + 1)) ||
      (!match && long.length)
    ) {
      throw new Error(`Incomplete/inconsistent context tiers for ${entry.model}`);
    }
  }
  for (const { entry } of usage) {
    if (!usage.some((item) => item.entry.model === entry.model && !item.entry.pricingTier)) {
      throw new Error(`Missing default tier for ${entry.model}`);
    }
  }
  const annual = table(annualText, ["model", "new_multiplier"]).map((row) => {
    if (!/^\d+(\.\d+)?$/.test(String(row.new_multiplier))) throw new Error("Invalid multiplier");
    const premiumRequests = Number(row.new_multiplier);
    if (!Number.isFinite(premiumRequests)) throw new Error("Non-finite multiplier");
    return { model: identity(row.model, data, models), displayName: row.model, premiumRequests };
  });
  for (const entries of [usage.map(({ entry }) => entry), annual]) {
    const keys = entries.map((entry) => `${entry.model}:${entry.minimumInputTokens ?? 0}`);
    if (new Set(keys).size !== keys.length) throw new Error("Duplicate model/tier in source");
  }
  return { usage: usage.map(({ entry }) => entry), annual };
}
