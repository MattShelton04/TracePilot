import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { githubApi, postReportComment } from "../ci/report-comment.mjs";
import { renderFreshness, validateReport } from "./report.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
const repo = process.env.GITHUB_REPOSITORY;
assert(
  run?.repository?.full_name === repo && run.path === ".github/workflows/pricing-freshness.yml",
  "Unexpected source workflow",
);
assert(
  Number.isSafeInteger(run.id) && run.id > 0 && /^[a-f0-9]{40}$/.test(run.head_sha),
  "Invalid source run",
);
assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "Invalid run attempt");
if (run.event !== "pull_request" || run.conclusion === "cancelled") process.exit(0);
const api = githubApi(repo, process.env.GITHUB_TOKEN);
const currentRun = await api(`/actions/runs/${run.id}`);
if (currentRun.run_attempt !== run.run_attempt) process.exit(0);
const associated = await api(`/commits/${run.head_sha}/pulls?per_page=100`);
const pr = associated.find(
  (item) =>
    item.state === "open" &&
    item.head.sha === run.head_sha &&
    item.base.repo.full_name === repo &&
    item.base.ref === event.repository.default_branch &&
    (!run.pull_requests?.length ||
      run.pull_requests.some((source) => source.number === item.number)),
);
if (!pr) {
  console.log("PR closed or superseded; skipping stale pricing report.");
  process.exit(0);
}
const path = join(process.env.PRICING_REPORT_DIR, "pricing-freshness.json");
const stat = await lstat(path);
assert(stat.isFile() && stat.size <= 1_000_000, "Invalid or oversized pricing artifact");
const report = validateReport(JSON.parse(await readFile(path, "utf8")));
assert(report.headSha === run.head_sha, "Mismatched report revision");
const family = "<!-- tracepilot-pricing-report:";
const marker = `${family}run=${run.id};attempt=${run.run_attempt};sha=${run.head_sha} -->`;
const body = `${marker}\n${renderFreshness(report)}\n[Check and full report](https://github.com/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt})\n`;
console.log(
  await postReportComment({
    api,
    pr: pr.number,
    run,
    body,
    marker,
    family,
    // Quiet when current; update an existing warning when fixed or unverifiable.
    createIfMissing: report.status === "outdated",
  }),
);
