import { postReportComment } from "../ci/report-comment.mjs";
import { escapeHtml, safeHttpUrl } from "./gallery-template.mjs";

export const commentMarker = "<!-- tracepilot-visual-report -->";
export function buildComment({ rows, summary, run, repo, galleryUrl, publisherRunId, baseSha }) {
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}`;
  const gallery = safeHttpUrl(galleryUrl);
  const attempt = run.run_attempt ?? 1;
  let body = `${commentMarker}\n<!-- tracepilot-visual-report:run=${run.id};attempt=${attempt};sha=${run.head_sha} -->\n### Desktop visual comparison\n\nCommit [${run.head_sha.slice(0, 8)}](https://github.com/${repo}/commit/${run.head_sha}) · [capture run ${run.id}, attempt ${attempt}](${runUrl}/attempts/${attempt})\n\nActual frontend at **1440×960**, dark, 100% scale, with deterministic **synthetic backend fixtures**. Rust/native verification is separate.\n\n**${summary.changed} review changes**, ${summary.unchanged} identical, ${summary.subtle ?? 0} subtle, ${summary.baseUnavailable} base unavailable, ${summary.incomplete} incomplete. Pixel changes require review; the gallery measures changed pixels and highlights their locations.\n\n`;
  if (/^[a-f0-9]{40}$/.test(baseSha))
    body += `Base [${baseSha.slice(0, 8)}](https://github.com/${repo}/commit/${baseSha}) → head ${run.head_sha.slice(0, 8)}.\n\n`;
  if (summary.baseUnavailable || summary.incomplete)
    body +=
      "**Comparison incomplete.** Unavailable or failed captures cannot establish that the UI is unchanged. Review capture limitations in the gallery.\n\n";
  if (!gallery)
    return `${body}[Capture artifacts](${runUrl}) · [Standalone gallery artifact](https://github.com/${repo}/actions/runs/${publisherRunId})\n\nPages publication is unavailable. Download visual-gallery and open index.html; precomputed pixel comparisons also work offline.\n`;
  const history = new URL("../../index.html", gallery).href;
  const galleryLink = `${gallery}?attempt=${attempt}`;
  body += `[Interactive gallery](${galleryLink}) · [Screenshot history](${history})\n\nSide by side, before/after, draggable wipe, opacity overlay, pixel differences, zoom and pan.\n\n`;
  const changed = rows.filter((row) => row.change === "changed");
  let embedded = 0;
  for (const row of changed) {
    const block = `<details><summary>${escapeHtml(row.id)} — pixels changed</summary>\n\n<code>${escapeHtml(row.route)}</code> · <code>${escapeHtml(row.state)}</code>\n\n[Highlight changed regions](${galleryLink}#view=${row.id}&mode=difference)\n\n| Before | After |\n|---|---|\n| ![Before ${row.id}](${gallery}base-${row.id}.png?attempt=${attempt}) | ![After ${row.id}](${gallery}head-${row.id}.png?attempt=${attempt}) |\n\n</details>\n\n`;
    // GitHub caps comment bodies. Leave room for the omitted-view index below.
    if (Buffer.byteLength(body + block, "utf8") > 48_000) break;
    body += block;
    embedded++;
  }
  if (embedded < changed.length) {
    body += `**${changed.length - embedded} additional changed views** are available in the [full gallery](${galleryLink}).\n\n`;
    for (const row of changed.slice(embedded)) {
      const link = `- [${row.id}](${galleryLink}#view=${row.id}&mode=difference)\n`;
      if (Buffer.byteLength(body + link, "utf8") > 59_000) break;
      body += link;
    }
  }
  const subtle = rows.filter((row) => row.change === "subtle");
  if (subtle.length) {
    body += `**${subtle.length} ${subtle.length === 1 ? "view has" : "views have"} subtle pixel differences** (at most 128 pixels per view, each channel differing by at most 8/255). These are not identical or automatically dismissed as harmless. Inspect their exact differences:\n\n`;
    for (const row of subtle) {
      const link = `- [${row.id}](${galleryLink}#view=${row.id}&mode=difference)\n`;
      if (Buffer.byteLength(body + link, "utf8") > 59_500) {
        body += `Additional subtle views are available in the [full gallery](${galleryLink}).\n`;
        break;
      }
      body += link;
    }
    body += "\n";
  }
  if (!changed.length && !summary.baseUnavailable && !summary.incomplete)
    body +=
      "No larger or higher-contrast pixel changes detected. Review any capture limitations in the gallery.\n";
  return body;
}

/** Preserve previous revision comments; duplicate deliveries do not post twice. */
export async function postComment({ api, pr, run, body }) {
  const marker = `<!-- tracepilot-visual-report:run=${run.id};attempt=${run.run_attempt ?? 1};sha=${run.head_sha} -->`;
  return postReportComment({ api, pr, run, body, marker });
}
