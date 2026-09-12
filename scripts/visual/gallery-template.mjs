import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { historyEntry } from "./history.mjs";

export function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}
export function scriptJson(value) {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
export function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
async function document({ title, body, data, scripts }) {
  const css = await readFile(new URL("./gallery/gallery.css", import.meta.url), "utf8");
  const code = (
    await Promise.all(
      scripts.map((name) => readFile(new URL(`./gallery/${name}`, import.meta.url), "utf8")),
    )
  ).join("\n");
  const hash = createHash("sha256").update(code).digest("base64");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'self'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${body}<script id="report-data" type="application/json">${scriptJson(data)}</script><script>${code}</script></body></html>`;
}
function counts(summary) {
  return `<div class="counts"><span class="count changed">${summary.changed} views changed</span><span class="count unchanged">${summary.unchanged} identical</span><span class="count">${summary.baseUnavailable + summary.incomplete} limitations</span></div>`;
}
export async function renderGallery({ title, rows, summary, metadata = {} }) {
  const runUrl = safeHttpUrl(metadata.runUrl);
  const body = `<header class="app-header"><div><p class="eyebrow">TRACEPILOT / VISUAL REVIEW</p><h1>${escapeHtml(title)}</h1><p class="header-meta">Real frontend · synthetic backend fixtures · 1440 × 960 · dark · 100% UI scale</p></div><div>${counts(summary)}<nav class="header-links" aria-label="Report links"><a id="history-link" href="../../index.html">Browse history ↗</a>${runUrl ? `<a href="${escapeHtml(runUrl)}">Capture run ↗</a>` : ""}<a href="summary.json">Summary JSON</a></nav></div></header>
<div class="workspace"><aside class="sidebar" aria-label="Captured views"><div class="filters"><input id="search" type="search" aria-label="Filter views" placeholder="Find a view…"><label><input id="changes" type="checkbox"> Changes and limitations only</label></div><nav id="view-list" class="view-list" aria-label="Views"></nav><div class="sidebar-footer"><span id="visible-count"></span><br>Pixel changes require human review.<br>Rust and native integration are not tested.</div></aside>
<main class="review"><div class="view-heading"><div><h2 id="view-title"></h2><p id="view-description" class="view-description"></p></div><span id="view-status" class="status-pill"></span></div>
<div class="toolbar"><div class="mode-group" role="group" aria-label="Comparison mode">${[
    ["side", "Side by side"],
    ["toggle", "Before / after"],
    ["wipe", "Wipe"],
    ["overlay", "Overlay"],
    ["difference", "Difference"],
  ]
    .map(
      ([mode, label]) =>
        `<button type="button" data-mode="${mode}" aria-pressed="false">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="zoom-group" role="group" aria-label="Zoom"><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-value" class="zoom-value"></span><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-fit">Fit</button><button id="zoom-actual">100%</button></div></div>
<div class="adjustments"><div id="toggle-controls"><button data-side="base" aria-pressed="false">Before</button> <button data-side="head" aria-pressed="true">After</button></div><label id="wipe-control">Before / after split <input id="wipe-range" type="range" min="0" max="100" value="50"><output id="wipe-value">50%</output></label><label id="opacity-control">After opacity <input id="opacity" type="range" min="0" max="100" value="50"><output id="opacity-value">50%</output></label><label id="threshold-control">Pixel threshold <select id="threshold"><option value="0">Exact (0)</option><option value="8">8 / 255</option><option value="16">16 / 255</option><option value="32">32 / 255</option></select></label><span id="mode-hint"></span></div>
<div id="viewport" class="stage-viewport" tabindex="0" aria-label="Screenshot comparison, scroll or drag to pan when zoomed" aria-describedby="pan-help"><div class="stage-space"><div id="scaled-stage" class="scaled-stage"><div id="image-stage" class="image-stage"></div></div></div></div><p id="pan-help" class="sr-only">Fit shows the complete viewport. At 100% or higher, drag the image or use scrollbars and arrow keys to pan. Comparison controls are keyboard accessible.</p>
<div class="pixel-summary"><span id="pixel-metric" role="status" aria-live="polite">Select a view to inspect its pixels.</span><span id="pixel-bounds"></span></div><div id="regions" class="regions" aria-label="Changed regions"></div><details id="limitations" class="limitations"><summary>Capture limitations</summary><ul id="issues"></ul></details></main></div>
<noscript><section class="no-script"><h2>Before and after images</h2><p>Enable JavaScript for wipe, overlay, pixel comparison and zoom.</p>${rows.map((row) => `<article><h3>${escapeHtml(row.id)} · ${escapeHtml(row.change)}</h3><p>${escapeHtml(row.route)} · ${escapeHtml(row.state)}</p>${["base", "head"].map((side) => (row[`${side}Hash`] ? `<img src="${side}-${row.id}.png" alt="${side} ${escapeHtml(row.id)}">` : "")).join("")}<ul>${["base", "head"].flatMap((side) => [...(row[side]?.errors ?? []), ...(row[side]?.missing ?? [])].map((message) => `<li>${escapeHtml(message)}</li>`)).join("")}</ul></article>`).join("")}</section></noscript>`;
  return document({
    title,
    body,
    data: {
      schema: 3,
      title,
      rows,
      summary,
      metadata: {
        runUrl,
        attempt:
          Number.isSafeInteger(metadata.attempt) && metadata.attempt > 0 ? metadata.attempt : 1,
      },
    },
    scripts: ["gallery.js"],
  });
}

export async function renderHistory(entries) {
  entries = entries.map(historyEntry).filter(Boolean).slice(0, 40);
  const body = `<header class="app-header"><div><p class="eyebrow">TRACEPILOT / VISUAL HISTORY</p><h1>The desktop, through every change</h1><p class="header-meta">1440 × 960 · actual frontend · synthetic backend fixtures</p></div><a href="../dev/">Developer workbench ↗</a></header><main class="history-main"><p class="history-note">Choose a view to follow its screenshots across retained commits. Each run opens its exact before/after comparison. Fixture or browser changes can also affect images; historical runs may use different fixture versions. The latest 20 main runs and 20 PR runs are retained.</p><div class="history-controls"><label>View<select id="history-view"></select></label><label>Runs<select id="history-kind"><option value="all">All runs</option><option value="main">Main only</option><option value="pr">Pull requests only</option></select></label><label>Find a commit or PR<input id="history-search" type="search" placeholder="Commit, PR or date…"></label></div><p id="history-count" class="history-note" role="status"></p><div id="history-grid" class="history-grid"></div></main>`;
  return document({
    title: "TracePilot visual history",
    body,
    data: { entries },
    scripts: ["history.js"],
  });
}
