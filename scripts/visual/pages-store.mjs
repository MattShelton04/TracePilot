// Pages layout: visual/runs/<id>/ holds each report's HTML/JSON, while every
// PNG lives once in visual/img/<sha256>.png. PR pushes share a merge-base
// screenshot and main runs share their predecessor's head, so most images are
// repeated across runs; before this store the site held ~6x duplicate bytes.
import { access, copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { renderHistory } from "./gallery-template.mjs";
import { historyEntry, retainedHistory } from "./history.mjs";
import { classifyPixels } from "./pixels.mjs";
import { decodePng } from "./png.mjs";
import {
  analyzePair,
  groupSharedChanges,
  imagePattern,
  reviewAssets,
  storeImage,
  writeReportPages,
} from "./report.mjs";

export const pagesImageRoot = "../../img/";
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Bounded history metadata: which views changed and their shared image names. */
export function entryImages(rows) {
  const images = {},
    changes = {},
    previews = {};
  for (const row of rows) {
    if (!idPattern.test(row.id)) continue;
    if (row.headImage) images[row.id] = row.headImage;
    if (row.change !== "unchanged") changes[row.id] = row.change;
    if (row.review?.difference) previews[row.id] = row.review.difference;
  }
  return { images, changes, previews };
}

/** Copy a standalone report's images into the shared store and render its run page. */
export async function publishRun({ visual, runId, output, title, rows, summary, metadata, files }) {
  const store = join(visual, "img");
  await mkdir(store, { recursive: true });
  for (const name of files) {
    if (!imagePattern.test(name)) throw new Error("Unexpected report image name");
    if (!(await exists(join(store, name))))
      await copyFile(join(output, "img", name), join(store, name));
  }
  // runId is a validated positive integer; this target stays inside visual/runs.
  const runDir = join(visual, "runs", String(runId));
  await rm(runDir, { recursive: true, force: true });
  await writeReportPages({
    output: runDir,
    title,
    rows,
    summary,
    metadata,
    imageRoot: pagesImageRoot,
  });
  await writeFile(join(runDir, "images.json"), JSON.stringify(files));
  return runDir;
}

const reportData = /<script id="report-data" type="application\/json">(.*?)<\/script>/s;

/**
 * Move a report published before the shared store into it, re-rendering the
 * page with the current viewer. Pixel metrics, heatmaps and difference/close-up
 * images are recomputed from the retained PNGs, so every legacy schema gains
 * the same review data. Only data this trusted publisher generated is read back.
 */
export async function migrateLegacyRun(runDir, store) {
  if (await exists(join(runDir, "images.json"))) return null;
  const html = await readFile(join(runDir, "index.html"), "utf8");
  if (html.length > 5_000_000) throw new Error("Oversized legacy report");
  const data = JSON.parse(reportData.exec(html)?.[1] ?? "null");
  if (![2, 3].includes(data?.schema) || !Array.isArray(data.rows))
    throw new Error("Unsupported legacy report");
  const files = new Set();
  const rows = data.rows.filter((row) => idPattern.test(row?.id)).slice(0, 128);
  for (const row of rows) {
    const decoded = {};
    for (const side of ["base", "head"]) {
      delete row[`${side}Image`];
      if (!row[`${side}Hash`]) continue;
      const bytes = await readFile(join(runDir, `${side}-${row.id}.png`)).catch(() => null);
      if (!bytes) {
        delete row[`${side}Hash`];
        continue;
      }
      decoded[side] = decodePng(bytes);
      row[`${side}Image`] = await storeImage(store, bytes, files);
    }
    delete row.analyses;
    delete row.review;
    if (!decoded.base || !decoded.head || !["changed", "subtle", "unchanged"].includes(row.change))
      continue;
    await analyzePair(row, decoded, store, files);
    row.change = classifyPixels(row.analyses);
    if (row.change === "changed")
      row.review = await reviewAssets(decoded, row.exactHeat, row.analyses[0], store, files);
    delete row.exactHeat;
  }
  groupSharedChanges(rows);
  const count = (status) => rows.filter((row) => row.change === status).length;
  const summary = {
    changed: count("changed"),
    unchanged: count("unchanged"),
    subtle: count("subtle"),
    incomplete: count("incomplete"),
    baseUnavailable: count("base unavailable"),
    total: rows.length,
  };
  await writeReportPages({
    output: runDir,
    title: String(data.title ?? "Visual comparison").slice(0, 300),
    rows,
    summary,
    metadata: { runUrl: data.metadata?.runUrl, attempt: data.metadata?.attempt },
    imageRoot: pagesImageRoot,
  });
  for (const file of await readdir(runDir))
    if (/^(base|head|diff)-[a-z0-9-]+\.png$/.test(file)) await rm(join(runDir, file));
  await writeFile(join(runDir, "images.json"), JSON.stringify([...files].sort()));
  return { rows, summary };
}

/** Delete shared images that no retained run references. */
export async function collectGarbage(visual, keptIds) {
  const referenced = new Set();
  for (const id of keptIds) {
    const listing = await readFile(join(visual, "runs", String(id), "images.json"), "utf8").catch(
      () => "[]",
    );
    for (const name of JSON.parse(listing)) if (imagePattern.test(name)) referenced.add(name);
  }
  let removed = 0;
  for (const name of await readdir(join(visual, "img")).catch(() => [])) {
    if (!imagePattern.test(name) || referenced.has(name)) continue;
    await rm(join(visual, "img", name));
    removed++;
  }
  return removed;
}

/**
 * Add one report to a checked-out gh-pages tree, prune history, migrate legacy
 * reports and rebuild the history index. Everything outside visual/ is kept.
 */
export async function updateSite({ tree, repo, run, report }) {
  const { output, title, rows, summary, metadata, files } = report;
  const visual = join(tree, "visual");
  const runs = join(visual, "runs");
  await mkdir(runs, { recursive: true });
  await publishRun({ visual, runId: run.id, output, title, rows, summary, metadata, files });
  await writeFile(
    join(runs, String(run.id), "entry.json"),
    JSON.stringify({
      ...run,
      base: metadata.baseSha ?? null,
      title,
      summary,
      views: rows.filter((row) => row.headHash).map((row) => row.id),
      ...entryImages(rows),
    }),
  );
  const entries = [];
  for (const id of await readdir(runs)) {
    if (!/^\d+$/.test(id)) continue;
    try {
      const bytes = await readFile(join(runs, id, "entry.json"));
      if (bytes.length > 100_000) continue;
      const entry = historyEntry(JSON.parse(bytes.toString("utf8")));
      if (entry && String(entry.id) === id) entries.push(entry);
    } catch {
      /* older incomplete run */
    }
  }
  // Bound the current site to 20 main and 20 PR runs, reserving the current
  // publication when it reruns an older ID. Git history remains available.
  const kept = retainedHistory(entries, run.id);
  const keptIds = new Set(kept.map((entry) => entry.id));
  for (const entry of entries)
    if (!keptIds.has(entry.id)) await rm(join(runs, String(entry.id)), { recursive: true });
  // Reports published before the shared image store move into it once.
  for (const [index, entry] of kept.entries()) {
    const runDir = join(runs, String(entry.id));
    try {
      const migrated = await migrateLegacyRun(runDir, join(visual, "img"));
      if (!migrated) continue;
      const raw = JSON.parse(await readFile(join(runDir, "entry.json"), "utf8"));
      // Classification is recomputed, so history counts follow the new report.
      const updated = { ...raw, summary: migrated.summary, ...entryImages(migrated.rows) };
      await writeFile(join(runDir, "entry.json"), JSON.stringify(updated));
      kept[index] = historyEntry(updated) ?? entry;
      console.log(`Migrated run ${entry.id} to the shared image store.`);
    } catch (error) {
      console.warn(`Run ${entry.id} kept its legacy layout: ${error.message}`);
    }
  }
  const removed = await collectGarbage(visual, keptIds);
  console.log(`Removed ${removed} unreferenced images.`);
  // The site is prebuilt HTML; skip the Jekyll pass over hundreds of PNGs.
  if (!(await exists(join(tree, ".nojekyll")))) await writeFile(join(tree, ".nojekyll"), "");
  await writeFile(join(visual, "index.html"), await renderHistory(kept, { repo }));
  await writeFile(join(visual, "history.json"), JSON.stringify(kept, null, 2));
  return { kept, removed };
}
