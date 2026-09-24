import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { escapeHtml, renderGallery } from "./gallery-template.mjs";
import { cases } from "./manifest.mjs";
import { classifyPixels, compare, describeBounds, thresholds } from "./pixels.mjs";
import { decodePng, encodeHeat, encodePng } from "./png.mjs";
import { areaKey, changeAreas, crop, differenceImage, focusRect } from "./review-images.mjs";

export { validatePng } from "./png.mjs";
export { escapeHtml };

async function readSide(directory, side) {
  const records = new Map();
  const revisions = new Set();
  for (const file of await readdir(directory).catch(() => [])) {
    if (!/^capture-[1-8]-[1-8]\.json$/.test(file)) continue;
    const bytes = await readFile(join(directory, file));
    if (bytes.length > 100_000) throw new Error("Capture metadata exceeds limit");
    const data = JSON.parse(bytes.toString("utf8"));
    if (data.schema !== 1 || !Array.isArray(data.cases) || data.cases.length > 128)
      throw new Error("Unsupported capture metadata");
    if (data.revision && data.revision !== side) throw new Error("Wrong capture revision");
    if (data.revisionSha) {
      if (!/^[a-f0-9]{40}$/.test(data.revisionSha)) throw new Error("Invalid capture SHA");
      revisions.add(data.revisionSha);
    }
    for (const row of data.cases) {
      if (!row || typeof row.id !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(row.id)) continue;
      if (!records.has(row.id) && records.size >= 128)
        throw new Error("Capture inventory exceeds limit");
      if (records.has(row.id)) throw new Error("Duplicate captured view across shards");
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
  if (revisions.size > 1) throw new Error("Capture shards contain different revisions");
  return { records, sha: [...revisions][0] };
}

/** Image names are content hashes, shared by every run that renders the same pixels. */
export const imagePattern = /^[a-f0-9]{64}\.png$/;
export async function storeImage(directory, bytes, files) {
  const name = `${createHash("sha256").update(bytes).digest("hex")}.png`;
  const path = join(directory, name);
  if (
    !(await access(path).then(
      () => true,
      () => false,
    ))
  )
    await writeFile(path, bytes);
  files.add(name);
  return name;
}

export async function buildReport({
  baseDir,
  headDir,
  output,
  title = "Desktop visual comparison",
  metadata = {},
}) {
  const images = join(output, "img");
  await mkdir(images, { recursive: true });
  const files = new Set();
  const baseSide = await readSide(baseDir, "base");
  const headSide = await readSide(headDir, "head");
  if (baseSide.sha && baseSide.sha === headSide.sha)
    throw new Error("Cannot compare a revision against itself");
  if (headSide.sha && metadata.expectedHeadSha && headSide.sha !== metadata.expectedHeadSha)
    throw new Error("Captured head does not match the workflow run");
  metadata = { ...metadata, baseSha: baseSide.sha, headSha: headSide.sha };
  const baseRows = baseSide.records;
  const headRows = headSide.records;
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
      // Error-page screenshots are diagnostics in the capture artifact, not a
      // before/after image that the viewer can accidentally compare as real UI.
      if (row[side]?.status !== "captured") continue;
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
      row[`${side}Image`] = await storeImage(images, bytes, files);
    }
    if (
      decoded.base &&
      decoded.head &&
      row.base?.status === "captured" &&
      row.head?.status === "captured"
    )
      await analyzePair(row, decoded, images, files);
    row.change =
      !row.headHash || row.head?.status !== "captured"
        ? "incomplete"
        : !row.baseHash || row.base?.status !== "captured"
          ? "base unavailable"
          : classifyPixels(row.analyses);
    if (row.change === "changed")
      row.review = await reviewAssets(decoded, row.exactHeat, row.analyses[0], images, files);
    delete row.exactHeat;
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
  groupSharedChanges(rows);
  await writeReportPages({
    output,
    title,
    rows,
    summary,
    metadata,
    imageRoot: "img/",
  });
  return { rows, summary, metadata, files: [...files].sort() };
}

/** Exact and thresholded pixel metrics plus heatmaps, computed once per pair. */
export async function analyzePair(row, decoded, images, files) {
  row.pngChanged = row.baseHash !== row.headHash;
  row.analyses = {};
  for (const threshold of thresholds) {
    // Once exact pixels match, every threshold has the same empty result.
    if (threshold && row.analyses[0].changed === 0) {
      row.analyses[threshold] = row.analyses[0];
      continue;
    }
    const result = await compare(decoded.base, decoded.head, 1440, 960, { threshold });
    if (threshold === 0) row.exactHeat = result.heat;
    const heatFile = result.changed
      ? await storeImage(images, encodeHeat(result.heat), files)
      : null;
    row.analyses[threshold] = {
      ...result,
      heat: undefined,
      heatFile,
      description: describeBounds(result, threshold, row.pngChanged),
    };
  }
}

/**
 * The comment and gallery show where pixels changed and a readable 1:1 close-up
 * of the largest areas. Full screenshots shrink to ~440px wide in a PR comment,
 * where small text changes would otherwise be illegible.
 */
export async function reviewAssets(decoded, heat, exact, images, files) {
  const areas = changeAreas(exact.regions);
  const focus = [];
  for (const area of areas.slice(0, 2)) {
    const rect = focusRect(area);
    if (!rect) continue;
    focus.push({
      area,
      rect,
      base: await storeImage(
        images,
        encodePng(rect.width, rect.height, crop(decoded.base, rect)),
        files,
      ),
      head: await storeImage(
        images,
        encodePng(rect.width, rect.height, crop(decoded.head, rect)),
        files,
      ),
    });
  }
  const difference = await storeImage(
    images,
    encodePng(1440, 960, differenceImage(decoded.head, heat, areas)),
    files,
  );
  return {
    areas: areas.slice(0, 12),
    areaCount: areas.length,
    difference,
    focus,
  };
}

/** Views with the same changed areas usually show one shared-component change. */
export function groupSharedChanges(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.review) continue;
    // Areas above 8/255 ignore sparse anti-aliasing speckle elsewhere in the view.
    const significant = row.analyses?.[8]?.regions;
    const key = areaKey(significant?.length ? changeAreas(significant) : row.review.areas);
    if (!groups.has(key)) groups.set(key, row);
    else {
      const lead = groups.get(key);
      lead.review.sharedWith = [...(lead.review.sharedWith ?? []), row.id];
      row.review.sameAs = lead.id;
    }
  }
}

/** Machine-readable review data: exact metrics and image URLs, no judgement. */
export function changeSummary({ rows, summary, metadata, imageRoot }) {
  const url = (name) => (name ? `${imageRoot}${name}` : null);
  return {
    schema: 1,
    baseSha: metadata.baseSha ?? null,
    headSha: metadata.headSha ?? null,
    viewport: { width: 1440, height: 960, theme: "dark", scale: 1 },
    summary,
    views: rows.map((row) => ({
      id: row.id,
      route: row.route,
      state: row.state,
      change: row.change,
      changedPixels: row.analyses?.[0]?.changed ?? null,
      percent: row.analyses?.[0]?.percent ?? null,
      areas: row.review?.areas ?? row.analyses?.[0]?.regions ?? [],
      sameAreasAs: row.review?.sameAs ?? null,
      images: {
        before: url(row.baseImage),
        after: url(row.headImage),
        difference: url(row.review?.difference),
        closeUps: (row.review?.focus ?? []).map((item) => ({
          rect: item.rect,
          before: url(item.base),
          after: url(item.head),
        })),
      },
      limitations: ["base", "head"].flatMap((side) =>
        [
          ...(row[side]?.errors ?? []),
          ...(row[side]?.missing ?? []).map((cmd) => `Missing fixture: ${cmd}`),
        ].map((message) => `${side}: ${message}`),
      ),
    })),
  };
}

/** Standalone reports use img/; Pages runs share ../../img/ across all runs. */
export async function writeReportPages({ output, title, rows, summary, metadata, imageRoot }) {
  await mkdir(output, { recursive: true });
  const html = await renderGallery({
    title,
    rows,
    summary,
    metadata: { ...metadata, imageRoot },
  });
  await writeFile(join(output, "index.html"), html);
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile(
    join(output, "changes.json"),
    JSON.stringify(changeSummary({ rows, summary, metadata, imageRoot }), null, 2),
  );
}
