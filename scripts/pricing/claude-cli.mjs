#!/usr/bin/env node
// pnpm pricing:claude [--write] [--date YYYY-MM-DD] [--report <path>]
// Compares Claude Code's bundled API rates with Anthropic's pricing page.
// Exit codes (preview): 0 current, 1 outdated, 2 could not verify.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CLAUDE_PRICING_MARKDOWN_URL,
  fetchClaudePricing,
  parseClaudePricing,
  reconcileClaudePricing,
} from "./claude.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dataPath = resolve(root, "packages/types/src/claude-code-pricing-data.json");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const rates = (values) =>
  Object.entries(values)
    .map(([field, value]) => `${field} ${value}`)
    .join(", ");

async function main() {
  const { values } = parseArgs({
    options: {
      write: { type: "boolean" },
      date: { type: "string" },
      report: { type: "string" },
    },
  });
  const checkedAt = values.date ?? new Date().toISOString().slice(0, 10);
  const data = JSON.parse(await readFile(dataPath, "utf8"));
  const report = {
    version: 1,
    checkedAt,
    source: CLAUDE_PRICING_MARKDOWN_URL,
    verifiedAt: data.source.verifiedAt,
    status: "unavailable",
    changes: [],
    retained: [],
  };
  let next;
  try {
    const { rows, footnotes } = parseClaudePricing(await fetchClaudePricing());
    next = reconcileClaudePricing(data, rows, checkedAt);
    Object.assign(report, {
      status: next.changes.length ? "outdated" : "current",
      changes: next.changes,
      retained: next.retained,
      footnotes,
    });
    console.log(
      `${rows.length} published Claude price rows; bundled rates verified ${data.source.verifiedAt}.`,
    );
    for (const change of next.changes) {
      console.log(
        change.kind === "added"
          ? `added ${change.model}: ${rates(change.after)}`
          : `changed ${change.model}: ${Object.keys(change.after)
              .map((field) => `${field} ${change.before[field]} -> ${change.after[field]}`)
              .join(", ")}`,
      );
    }
    for (const model of next.retained) console.log(`retained ${model}: no longer on the page`);
    for (const note of footnotes) console.log(`footnote: ${note}`);
  } catch (error) {
    report.error = `Could not verify current Claude pricing: ${error.message}`;
    console.error(report.error);
  }
  if (values.report) {
    const reportPath = resolve(values.report);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, json(report));
  }
  if (report.status === "unavailable") {
    process.exitCode = 2;
    return;
  }
  if (values.write) {
    await writeFile(dataPath, json(next.data));
    console.log(
      `Wrote ${next.changes.length} change(s), verified ${checkedAt}. Run pnpm exec biome format --write ${dataPath} and review the diff.`,
    );
    return;
  }
  console.log(
    report.status === "current"
      ? "Bundled Claude rates match the published page."
      : "Outdated; run pnpm pricing:claude --write and review the diff.",
  );
  process.exitCode = report.status === "current" ? 0 : 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 2;
});
