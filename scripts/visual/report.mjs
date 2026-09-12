import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml, renderGallery } from "./gallery-template.mjs";
import { cases } from "./manifest.mjs";
import { classifyPixels, compare, describeBounds, thresholds } from "./pixels.mjs";
import { decodePng, encodeHeat } from "./png.mjs";

export { validatePng } from "./png.mjs";
export { escapeHtml };

async function readSide(directory) {
  const records = new Map();
  for (const file of await readdir(directory).catch(() => [])) {
    if (!/^capture-[1-8]-[1-8]\.json$/.test(file)) continue;
    const bytes = await readFile(join(directory, file));
    if (bytes.length > 100_000) throw new Error("Capture metadata exceeds limit");
    const data = JSON.parse(bytes.toString("utf8"));
    if (data.schema !== 1 || !Array.isArray(data.cases) || data.cases.length > 128)
      throw new Error("Unsupported capture metadata");
    for (const row of data.cases) {
      if (!row || typeof row.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id)) continue;
      if (!records.has(row.id) && records.size >= 128)
        throw new Error("Capture inventory exceeds limit");
      records.set(row.id, {
        route: typeof row.route === "string" ? row.route.slice(0, 300) : "",
        state: typeof row.state === "string" ? row.state.slice(0, 300) : "",
        status: row.status === "captured" ? "captured" : "incomplete",
        errors: Array.isArray(row.errors)
          ? row.errors.slice(0, 3).map((x) => String(x).slice(0, 500))
          : [],
        missing: Array.isArray(row.missingFixtures)
          ? row.missingFixtures
              .slice(0, 15)
              .map((x) => String(x?.command ?? "Unknown command").slice(0, 80))
          : [],
      });
    }
  }
  return records;
}

export async function buildReport({
  baseDir,
  headDir,
  output,
  title = "Desktop visual comparison",
  metadata = {},
}) {
  await mkdir(output, { recursive: true });
  const baseRows = await readSide(baseDir);
  const headRows = await readSide(headDir);
  // A route first introduced by a PR must remain visible before its manifest
  // reaches the trusted default branch. Only bounded text/IDs cross this boundary.
  const inventory = new Map(cases.map((item) => [item.id, item]));
  for (const [id, record] of [...baseRows, ...headRows]) {
    if (!inventory.has(id)) {
      if (inventory.size >= 128) throw new Error("Combined capture inventory exceeds limit");
      inventory.set(id, { id, route: record.route, state: record.state });
    }
  }
  const rows = [];
  for (const item of inventory.values()) {
    const base = baseRows.get(item.id),
      head = headRows.get(item.id);
    // Describe the captured fixture state, including historical feature defaults.
    const row = {
      ...item,
      route: head?.route || base?.route || item.route,
      state: head?.state || base?.state || item.state,
      base,
      head,
    };
    const decoded = {};
    for (const [side, directory] of [
      ["base", baseDir],
      ["head", headDir],
    ]) {
      const source = join(directory, `${item.id}.png`);
      const bytes = await readFile(source).catch(() => null);
      if (!bytes) continue;
      try {
        decoded[side] = decodePng(bytes);
      } catch {
        const record = row[side] ?? { errors: [], missing: [] };
        row[side] = {
          ...record,
          status: "incomplete",
          errors: [...record.errors, "Screenshot PNG could not be safely decoded."],
        };
        continue;
      }
      row[`${side}Hash`] = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(output, `${side}-${item.id}.png`), bytes);
    }
    if (decoded.base && decoded.head) {
      row.pngChanged = row.baseHash !== row.headHash;
      row.analyses = {};
      for (const threshold of thresholds) {
        // Once exact pixels match, every threshold has the same empty result.
        if (threshold && row.analyses[0].changed === 0) {
          row.analyses[threshold] = row.analyses[0];
          continue;
        }
        const result = await compare(decoded.base, decoded.head, 1440, 960, { threshold });
        const heatFile = result.changed ? `diff-${item.id}-${threshold}.png` : null;
        if (heatFile) await writeFile(join(output, heatFile), encodeHeat(result.heat));
        row.analyses[threshold] = {
          ...result,
          heat: undefined,
          heatFile,
          description: describeBounds(result, threshold, row.pngChanged),
        };
      }
    }
    row.change =
      !row.headHash || row.head?.status !== "captured"
        ? "incomplete"
        : !row.baseHash || row.base?.status !== "captured"
          ? "base unavailable"
          : classifyPixels(row.analyses);
    rows.push(row);
  }
  const count = (status) => rows.filter((row) => row.change === status).length;
  const summary = {
    changed: count("changed"),
    unchanged: count("unchanged"),
    subtle: count("subtle"),
    incomplete: count("incomplete"),
    baseUnavailable: count("base unavailable"),
    total: rows.length,
  };
  const html = await renderGallery({ title, rows, summary, metadata });
  await writeFile(join(output, "index.html"), html);
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  return { rows, summary };
}
