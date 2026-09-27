import assert from "node:assert/strict";

const text = (value) =>
  String(value).replace(/[&<>@`[\]*_\r\n|]/g, (char) => `&#${char.charCodeAt(0)};`);
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");

// Reports are data from an unprivileged PR job, never trusted Markdown or code.
export function validateReport(report) {
  assert(
    report?.version === 1 && ["current", "outdated", "unavailable"].includes(report.status),
    "Invalid pricing report",
  );
  assert(sha(report.snapshotRevision) && sha(report.headSha), "Invalid report revisions");
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(report.checkedAt) && /^\d{4}-\d{2}-\d{2}$/.test(report.snapshotDate),
    "Invalid report dates",
  );
  if (report.status !== "unavailable")
    assert(sha(report.upstreamRevision), "Missing upstream revision");
  assert(
    Array.isArray(report.changes) && report.changes.length <= 2000,
    "Invalid pricing differences",
  );
  assert(
    report.status !== "current" || report.changes.length === 0,
    "Current report contains differences",
  );
  assert(
    report.status !== "outdated" || report.changes.length > 0,
    "Outdated report has no differences",
  );
  for (const change of report.changes) {
    assert(
      ["usage", "annual", "footnotes", "expiry"].includes(change.table),
      "Invalid difference table",
    );
    assert(["added", "removed", "changed"].includes(change.kind), "Invalid difference kind");
    for (const field of ["key", "before", "after"])
      assert(
        typeof change[field] === "string" && change[field].length <= 10000,
        "Invalid difference text",
      );
  }
  if (report.status === "unavailable")
    assert(
      typeof report.error === "string" && report.error.length <= 10000,
      "Missing verification error",
    );
  return report;
}

export function renderFreshness(report) {
  let body = "### Copilot pricing freshness\n\n";
  body +=
    report.status === "outdated"
      ? "**Pricing needs review.** GitHub's published pricing or the saved promotion validity has changed.\n\n"
      : report.status === "current"
        ? "**Pricing is current.** The saved token tiers, thresholds, annual multipliers and footnotes match GitHub's latest source.\n\n"
        : `**Could not verify freshness.** This is not a passing freshness check. ${text(report.error.slice(0, 2000))}\n\n`;
  body += `Checked ${text(report.checkedAt)}; saved snapshot ${text(report.snapshotDate)}.\n\n`;
  if (report.upstreamRevision && sha(report.upstreamRevision))
    body += `[Latest source](https://github.com/github/docs/commit/${report.upstreamRevision}) · `;
  body += `[Saved source](https://github.com/github/docs/commit/${report.snapshotRevision})\n\n`;
  if (report.changes.length) {
    body +=
      "| Source | Model / tier or note | Change | Saved | Latest |\n| --- | --- | --- | --- | --- |\n";
    let shown = 0;
    for (const change of report.changes.slice(0, 20)) {
      const line = `| ${text(change.table)} | ${text(change.key.slice(0, 200))} | ${text(change.kind)} | ${text(change.before.slice(0, 400))} | ${text(change.after.slice(0, 400))} |\n`;
      if (Buffer.byteLength(body + line, "utf8") > 52000) break;
      body += line;
      shown++;
    }
    if (report.changes.length > shown)
      body += `\n${report.changes.length - shown} more differences are in the workflow artifact.\n`;
    body +=
      "\nUpdate with `pnpm pricing:fetch`, review new identities and footnotes, then run `pnpm pricing:update --write` and the pricing tests.\n";
  }
  return `${body}\nThis live check is advisory. The required snapshot consistency check verifies the app's bundled prices separately.\n`;
}
