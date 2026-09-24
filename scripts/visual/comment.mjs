import { postReportComment } from "../ci/report-comment.mjs";
import { escapeHtml, safeHttpUrl } from "./gallery-template.mjs";

export const commentMarker = "<!-- tracepilot-visual-report -->";
const expandedViews = 3;
const number = (value) => Number(value ?? 0).toLocaleString("en-US");
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function viewBlock(row, { galleryLink, images }) {
  const review = row.review;
  const exact = row.analyses?.[0];
  const id = escapeHtml(row.id);
  const areas = review?.areaCount ?? exact?.regionCount ?? 0;
  const heading = exact
    ? `${number(exact.changed)} px changed (${exact.percent.toFixed(2)}%) in ${plural(areas, "area")}`
    : "pixels changed";
  let block = `<code>${escapeHtml(row.route)}</code> · ${escapeHtml(row.state)} · [Inspect in gallery](${galleryLink}#view=${row.id}&mode=difference)\n\n`;
  if (review?.difference)
    block += `![Difference for ${id}: after screenshot dimmed, changed pixels pink, changed areas outlined](${images}${review.difference})\n\n`;
  const [focus] = review?.focus ?? [];
  if (focus) {
    const { x, y, width, height } = focus.area;
    block += `**Largest area** at ${x},${y} (${width}×${height}), shown at 1:1:\n\n| Before | After |\n|---|---|\n| ![Before close-up of ${id}](${images}${focus.base}) | ![After close-up of ${id}](${images}${focus.head}) |\n\n`;
  } else if (review) {
    block += `The change covers most of the view; compare the full screenshots in the gallery.\n\n`;
  }
  if (review?.sharedWith?.length)
    block += `Same changed areas in ${plural(review.sharedWith.length, "other view")}: ${review.sharedWith.map((other) => `[${escapeHtml(other)}](${galleryLink}#view=${other}&mode=difference)`).join(", ")}.\n\n`;
  return { id, heading, block };
}

export function buildComment({ rows, summary, run, repo, galleryUrl, publisherRunId, baseSha }) {
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}`;
  const gallery = safeHttpUrl(galleryUrl);
  const attempt = run.run_attempt ?? 1;
  const commit = (sha) => `[${sha.slice(0, 8)}](https://github.com/${repo}/commit/${sha})`;
  const review = summary.changed;
  let body = `${commentMarker}\n<!-- tracepilot-visual-report:run=${run.id};attempt=${attempt};sha=${run.head_sha} -->\n### Desktop visual comparison\n\n`;
  body += /^[a-f0-9]{40}$/.test(baseSha ?? "")
    ? `**Whole PR:** base ${commit(baseSha)} → head ${commit(run.head_sha)}`
    : `**Head:** ${commit(run.head_sha)}`;
  body += ` · [capture run ${run.id}, attempt ${attempt}](${runUrl}/attempts/${attempt})\n\n`;
  body += `**${plural(review, "view needs", "views need")} review** · ${summary.subtle ?? 0} subtle · ${summary.unchanged} identical · ${summary.baseUnavailable} base unavailable · ${summary.incomplete} incomplete\n\n`;
  if (summary.baseUnavailable || summary.incomplete)
    body +=
      "**Comparison incomplete.** Unavailable or failed captures cannot establish that the UI is unchanged. Review capture limitations in the gallery.\n\n";
  const footer = `<sub>Every push re-compares the entire PR against its merge base with the default branch; this comment is updated in place. Actual frontend at 1440×960, dark, 100% scale, with deterministic synthetic backend fixtures. Rust/native behaviour is verified separately.</sub>\n`;
  if (!gallery)
    return `${body}[Capture artifacts](${runUrl}) · [Standalone gallery artifact](https://github.com/${repo}/actions/runs/${publisherRunId})\n\nPages publication is unavailable. Download visual-gallery and open index.html; precomputed pixel comparisons also work offline.\n\n${footer}`;
  const history = new URL("../../index.html", gallery).href;
  const images = new URL("../../img/", gallery).href;
  const galleryLink = `${gallery}?attempt=${attempt}`;
  body += `[Interactive gallery](${galleryLink}) · [Machine-readable changes](${gallery}changes.json) · [Screenshot history](${history})\n\n`;
  // Largest changes first; views repeating another view's areas are folded into it.
  const changed = rows
    .filter((row) => row.change === "changed" && !row.review?.sameAs)
    .sort((a, b) => (b.analyses?.[0]?.changed ?? 0) - (a.analyses?.[0]?.changed ?? 0));
  let embedded = 0;
  for (const row of changed) {
    const { id, heading, block } = viewBlock(row, { galleryLink, images });
    const section =
      embedded < expandedViews
        ? `#### ${id} · ${heading}\n\n${block}`
        : `<details><summary><b>${id}</b> · ${heading}</summary>\n\n${block}</details>\n\n`;
    // GitHub caps comment bodies. Leave room for the omitted-view index below.
    if (Buffer.byteLength(body + section + footer, "utf8") > 52_000) break;
    body += section;
    embedded++;
  }
  if (embedded < changed.length) {
    body += `**${changed.length - embedded} additional changed views** are available in the [full gallery](${galleryLink}).\n\n`;
    for (const row of changed.slice(embedded)) {
      const link = `- [${row.id}](${galleryLink}#view=${row.id}&mode=difference)\n`;
      if (Buffer.byteLength(body + link + footer, "utf8") > 59_000) break;
      body += link;
    }
    body += "\n";
  }
  const subtle = rows.filter((row) => row.change === "subtle");
  if (subtle.length) {
    let list = "";
    for (const row of subtle) {
      const link = `- [${row.id}](${galleryLink}#view=${row.id}&mode=difference) · ${number(row.analyses?.[0]?.changed)} px\n`;
      if (Buffer.byteLength(body + list + link + footer, "utf8") > 59_500) {
        list += "- Additional subtle views are listed in the full gallery.\n";
        break;
      }
      list += link;
    }
    body += `<details><summary>${plural(subtle.length, "view has", "views have")} subtle pixel differences (at most 128 pixels, each channel within 8/255)</summary>\n\nThese are neither identical nor automatically dismissed. Inspect their exact differences:\n\n${list}\n</details>\n\n`;
  }
  const limited = rows.filter((row) => ["base unavailable", "incomplete"].includes(row.change));
  if (limited.length)
    body += `Unavailable or incomplete: ${limited.map((row) => `[${escapeHtml(row.id)}](${galleryLink}#view=${row.id})`).join(", ")}.\n\n`;
  if (!review && !summary.baseUnavailable && !summary.incomplete)
    body +=
      "No larger or higher-contrast pixel changes detected. Review any capture limitations in the gallery.\n\n";
  return body + footer;
}

/** One sticky report per PR; duplicate deliveries do not edit it twice. */
export async function postComment({ api, pr, run, body }) {
  const marker = `<!-- tracepilot-visual-report:run=${run.id};attempt=${run.run_attempt ?? 1};sha=${run.head_sha} -->`;
  return postReportComment({ api, pr, run, body, marker, family: commentMarker });
}
