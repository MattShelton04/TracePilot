#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { extractFootnotes, parseSources, requireDate, SOURCE_PATHS, sha256 } from "./source.mjs";
import { updatePricing } from "./update.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceDir = resolve(root, "packages/types/data/copilot-pricing");
const dataPath = resolve(root, "packages/types/src/pricing-data.json");
const modelPath = resolve(root, "packages/types/data/model-registry.json");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

async function fetchSnapshot(revision, verifiedAt) {
  requireDate(verifiedAt);
  if (!/^[a-f0-9]{40}$/.test(revision ?? ""))
    throw new Error("--revision requires a full github/docs commit SHA");
  const sources = Object.fromEntries(
    await Promise.all(
      Object.entries(SOURCE_PATHS).map(async ([key, path]) => {
        const response = await fetch(
          `https://raw.githubusercontent.com/github/docs/${revision}/${path}`,
          {
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new Error(`Download failed (${response.status}): ${path}`);
        return [key, (await response.text()).replaceAll("\r\n", "\n")];
      }),
    ),
  );
  const snapshot = {
    revision,
    verifiedAt,
    sha256: Object.fromEntries(Object.entries(sources).map(([key, text]) => [key, sha256(text)])),
    footnotes: extractFootnotes(sources.page),
  };
  // Fetch only freezes evidence. Unknown identities/footnotes are reviewed before update.
  await mkdir(sourceDir, { recursive: true });
  await writeFile(resolve(sourceDir, "models-and-pricing.yml"), sources.usage);
  await writeFile(resolve(sourceDir, "annual-subscriber-model-multipliers.yml"), sources.annual);
  await writeFile(resolve(sourceDir, "snapshot.json"), json(snapshot));
  console.log(
    `Frozen github/docs@${revision} (${verifiedAt}). Review source, aliases and footnotes; run pnpm pricing:update.`,
  );
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { revision: { type: "string" }, date: { type: "string" }, write: { type: "boolean" } },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !["fetch", "update", "check"].includes(command)) {
    throw new Error(
      "Usage: cli.mjs fetch --revision <sha> --date <YYYY-MM-DD> | update [--write] | check",
    );
  }
  if (command === "fetch") {
    if (values.write) throw new Error("fetch does not accept --write");
    return fetchSnapshot(values.revision, values.date);
  }
  if (values.revision || values.date || (command === "check" && values.write))
    throw new Error("Invalid options for command");
  const [data, models, snapshot, policy, usage, annual] = await Promise.all([
    readJson(dataPath),
    readJson(modelPath),
    readJson(resolve(sourceDir, "snapshot.json")),
    readJson(resolve(sourceDir, "policy.json")),
    readFile(resolve(sourceDir, "models-and-pricing.yml"), "utf8"),
    readFile(resolve(sourceDir, "annual-subscriber-model-multipliers.yml"), "utf8"),
  ]);
  // Normalize Git checkout line endings; the digest represents upstream LF text.
  const parsed = parseSources(
    snapshot,
    usage.replaceAll("\r\n", "\n"),
    annual.replaceAll("\r\n", "\n"),
    policy,
    data,
    models,
  );
  const next = updatePricing(data, models, parsed, snapshot);
  const changed = !isDeepStrictEqual(data, next.data) || !isDeepStrictEqual(models, next.models);
  console.log(
    `${parsed.usage.length} published token tiers; ${parsed.annual.length} annual multipliers; snapshot ${snapshot.verifiedAt}.`,
  );
  for (const [name, before, after, fields] of [
    [
      "usage",
      data.githubCopilotUsage,
      next.data.githubCopilotUsage,
      ["inputPerM", "cachedInputPerM", "cacheWritePerM", "outputPerM"],
    ],
    [
      "annual",
      data.annualLegacyMultipliers,
      next.data.annualLegacyMultipliers,
      ["premiumRequests"],
    ],
  ]) {
    for (const row of after) {
      const old = before.find(
        (item) => item.model === row.model && item.minimumInputTokens === row.minimumInputTokens,
      );
      if (!isDeepStrictEqual(old, row)) {
        console.log(
          `${name} ${row.model} ${row.pricingTier ?? "default"}: ${fields.map((field) => `${field} ${old?.[field] ?? "new"} -> ${row[field]}`).join(", ")}`,
        );
        if (row.sourceNote !== old?.sourceNote && row.sourceNote)
          console.log(`  ${row.sourceNote}`);
      }
    }
    for (const row of before) {
      if (
        !after.some(
          (item) => item.model === row.model && item.minimumInputTokens === row.minimumInputTokens,
        )
      ) {
        console.log(
          `${name} ${row.model} at ${row.minimumInputTokens ?? 0} input tokens: archived tier`,
        );
      }
    }
  }
  if (command === "check" && changed)
    throw new Error("Pricing drift: run pnpm pricing:update --write and review the diff");
  if (changed && values.write) {
    // Both outputs are calculated and validated before either is written.
    await writeFile(dataPath, json(next.data));
    await writeFile(modelPath, json(next.models));
    console.log(
      "Updated pricing data and shared model defaults. Run pnpm exec biome format --write on these files.",
    );
  } else {
    console.log(
      changed
        ? "Dry run; pass --write to apply."
        : "Pricing and shared model defaults match the frozen source.",
    );
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
