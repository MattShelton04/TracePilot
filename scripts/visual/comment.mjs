import { escapeHtml, safeHttpUrl } from "./gallery-template.mjs";

export const commentMarker = "<!-- tracepilot-visual-report -->";
const ownComment = (comment) =>
  comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(commentMarker);

export function commentRevision(body) {
  const match = /<!-- tracepilot-visual-report:run=(\d+);attempt=(\d+);sha=([a-f0-9]{40}) -->/.exec(
    body ?? "",
  );
  return match ? { id: Number(match[1]), attempt: Number(match[2]), sha: match[3] } : null;
}

export function buildComment({ rows, summary, run, repo, galleryUrl, publisherRunId }) {
  const runUrl = `https://github.com/${repo}/actions/runs/${run.id}`;
  const gallery = safeHttpUrl(galleryUrl);
  const attempt = run.run_attempt ?? 1;
  let body = `${commentMarker}\n<!-- tracepilot-visual-report:run=${run.id};attempt=${attempt};sha=${run.head_sha} -->\n### Desktop visual comparison\n\nCommit [${run.head_sha.slice(0, 8)}](https://github.com/${repo}/commit/${run.head_sha}) · [capture run ${run.id}, attempt ${attempt}](${runUrl}/attempts/${attempt})\n\nActual frontend at **1440×960**, dark, 100% scale, with deterministic **synthetic backend fixtures**. Rust/native verification is separate.\n\n**${summary.changed} review changes**, ${summary.unchanged} identical, ${summary.subtle ?? 0} subtle, ${summary.baseUnavailable} base unavailable, ${summary.incomplete} incomplete. Pixel changes require review; the gallery measures changed pixels and highlights their locations.\n\n`;
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
  if (!changed.length)
    body +=
      "No larger or higher-contrast pixel changes detected. Review any capture limitations in the gallery.\n";
  return body;
}

/** Update one bot-owned issue comment; issue comments have no resolved state. */
export async function updateComment({ api, pr, run, body }) {
  const current = await api(`/pulls/${pr}`);
  if (current.state !== "open" || current.head.sha !== run.head_sha) return "stale-head";
  const previous = [];
  for (let page = 1; ; page++) {
    const comments = await api(`/issues/${pr}/comments?per_page=100&page=${page}`);
    previous.push(...comments.filter(ownComment));
    if (comments.length < 100) break;
  }
  if (
    previous.some((comment) => {
      const revision = commentRevision(comment.body);
      return (
        revision?.sha === run.head_sha &&
        (revision.id > run.id ||
          (revision.id === run.id && revision.attempt > (run.run_attempt ?? 1)))
      );
    })
  )
    return "newer-report";
  previous.sort((a, b) => a.id - b.id);
  // Recheck after pagination so a new commit never receives the preceding report.
  const latest = await api(`/pulls/${pr}`);
  if (latest.state !== "open" || latest.head.sha !== run.head_sha) return "stale-head";
  await api(previous.length ? `/issues/comments/${previous[0].id}` : `/issues/${pr}/comments`, {
    method: previous.length ? "PATCH" : "POST",
    body: JSON.stringify({ body }),
    headers: { "Content-Type": "application/json" },
  });
  for (const duplicate of previous.slice(1))
    await api(`/issues/comments/${duplicate.id}`, { method: "DELETE" });
  return previous.length ? "updated" : "created";
}
