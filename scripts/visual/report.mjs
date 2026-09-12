import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cases } from "./manifest.mjs";

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

export function validatePng(bytes) {
  return (
    bytes.length >= 24 &&
    bytes.length <= 8_000_000 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR" &&
    bytes.readUInt32BE(16) === 1440 &&
    bytes.readUInt32BE(20) === 960
  );
}

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
      records.set(row.id, {
        route: typeof row.route === "string" ? row.route.slice(0, 300) : "",
        state: typeof row.state === "string" ? row.state.slice(0, 300) : "",
        status: row.status === "captured" ? "captured" : "incomplete",
        errors: Array.isArray(row.errors)
          ? row.errors.slice(0, 3).map((x) => String(x).slice(0, 500))
          : [],
        missing: Array.isArray(row.missingFixtures)
          ? row.missingFixtures.slice(0, 15).map((x) => String(x.command).slice(0, 80))
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
}) {
  await mkdir(output, { recursive: true });
  const baseRows = await readSide(baseDir);
  const headRows = await readSide(headDir);
  // A route first introduced by a PR must remain visible before its manifest
  // reaches the trusted default branch. Only bounded text/IDs cross this boundary.
  const inventory = new Map(cases.map((item) => [item.id, item]));
  for (const [id, record] of [...baseRows, ...headRows]) {
    if (!inventory.has(id)) inventory.set(id, { id, route: record.route, state: record.state });
  }
  const rows = [];
  for (const item of inventory.values()) {
    const row = { ...item, base: baseRows.get(item.id), head: headRows.get(item.id) };
    for (const [side, directory] of [
      ["base", baseDir],
      ["head", headDir],
    ]) {
      const source = join(directory, `${item.id}.png`);
      const bytes = await readFile(source).catch(() => null);
      if (!bytes || !validatePng(bytes)) continue;
      row[`${side}Hash`] = createHash("sha256").update(bytes).digest("hex");
      await copyFile(source, join(output, `${side}-${item.id}.png`));
    }
    row.change =
      !row.headHash || row.head?.status !== "captured"
        ? "incomplete"
        : !row.baseHash || row.base?.status !== "captured"
          ? "base unavailable"
          : row.baseHash === row.headHash
            ? "unchanged"
            : "changed";
    rows.push(row);
  }
  const count = (status) => rows.filter((row) => row.change === status).length;
  const summary = {
    changed: count("changed"),
    unchanged: count("unchanged"),
    incomplete: count("incomplete"),
    baseUnavailable: count("base unavailable"),
    total: rows.length,
  };
  const cards = rows
    .map((row) => {
      const images = ["base", "head"]
        .map(
          (side) =>
            `<figure><figcaption>${side === "base" ? "Before / base" : "After / head"}</figcaption>${row[`${side}Hash`] ? `<a href="${side}-${row.id}.png"><img src="${side}-${row.id}.png" width="1440" height="960" loading="lazy" alt="${side} ${escapeHtml(row.id)}"></a>` : "<p>Capture unavailable</p>"}</figure>`,
        )
        .join("");
      const issues = ["base", "head"]
        .flatMap((side) =>
          [
            ...(row[side]?.errors ?? []),
            ...(row[side]?.missing ?? []).map((cmd) => `Missing fixture: ${cmd}`),
          ].map((message) => `<li>${side}: ${escapeHtml(message)}</li>`),
        )
        .join("");
      return `<article data-status="${row.change}" data-name="${row.id}"><h2>${row.id} <small>${row.change}</small></h2><p>${escapeHtml(row.route)} · ${escapeHtml(row.state)}</p><div class="pair">${images}</div>${issues ? `<details><summary>Coverage limitations</summary><ul>${issues}</ul></details>` : ""}</article>`;
    })
    .join("\n");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(title)}</title>
<style>body{font:16px system-ui;margin:24px;background:#101217;color:#e4e7ef}h1{margin-bottom:8px}header{position:sticky;top:0;background:#101217;padding:12px 0;z-index:1}p{color:#b2bacb}input{padding:8px;font:inherit}label{margin-left:16px}article{padding:20px;margin:20px 0;border:1px solid #434b5c;border-radius:12px}h2{font-size:20px}small{font-size:14px;color:#c2c9d5}a{color:#b9a6ff}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}figure{margin:0;min-width:0}figcaption{margin-bottom:8px}img{width:100%;height:auto}li{overflow-wrap:anywhere}article[hidden]{display:none}@media(max-width:900px){.pair{grid-template-columns:1fr}}</style>
<header><h1>${escapeHtml(title)}</h1><p>Actual TracePilot frontend · synthetic backend fixtures · Chromium · 1440×960 CSS px · dark · 100% scale. This does not test Rust or native desktop integration.</p><p>${summary.changed} changed · ${summary.unchanged} unchanged · ${summary.baseUnavailable} base unavailable · ${summary.incomplete} incomplete. Exact PNG comparison on matching runners; visual changes require human review.</p><input id="search" aria-label="Filter views" placeholder="Filter views"><label><input id="changes" type="checkbox"> Changes and limitations only</label></header>${cards}
<script>const search=document.querySelector('#search'),changes=document.querySelector('#changes');function filter(){for(const card of document.querySelectorAll('article'))card.hidden=!card.dataset.name.includes(search.value.toLowerCase())||(changes.checked&&card.dataset.status==='unchanged')}search.addEventListener('input',filter);changes.addEventListener('change',filter);</script></html>`;
  await writeFile(join(output, "index.html"), html);
  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  return { rows, summary };
}
