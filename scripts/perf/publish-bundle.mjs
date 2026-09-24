import assert from "node:assert/strict";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { githubApi, postReportComment } from "../ci/report-comment.mjs";
import { renderBundleMarkdown, validateBundleReport } from "./bundle-markdown.mjs";

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
const run = event.workflow_run;
const repo = process.env.GITHUB_REPOSITORY;
assert(
  run?.repository?.full_name === repo && run.path === ".github/workflows/bundle-analysis.yml",
  "Unexpected source workflow",
);
assert(
  Number.isSafeInteger(run.id) && run.id > 0 && /^[a-f0-9]{40}$/.test(run.head_sha),
  "Invalid source run",
);
assert(Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "Invalid run attempt");
if (run.event !== "pull_request" || run.conclusion !== "success") process.exit(0);
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
  console.log("PR closed or superseded; skipping stale report.");
  process.exit(0);
}
async function measurement(side) {
  const path = join(process.env.BUNDLE_REPORT_DIR, `bundle-${side}`, "bundle-report.json");
  const stat = await lstat(path);
  assert(stat.isFile() && stat.size <= 1_000_000, "Invalid or oversized bundle artifact");
  const report = validateBundleReport(JSON.parse(await readFile(path, "utf8")));
  assert(/^[a-f0-9]{40}$/.test(report.metadata?.sha), "Missing measured revision");
  return report;
}
const head = await measurement("head");
const base = await measurement("base");
assert(
  head.metadata.sha === run.head_sha && base.metadata.sha !== head.metadata.sha,
  "Mismatched comparison revisions",
);
const marker = `<!-- tracepilot-bundle-report:run=${run.id};attempt=${run.run_attempt};sha=${run.head_sha} -->`;
const commit = (sha) => `[${sha.slice(0, 8)}](https://github.com/${repo}/commit/${sha})`;
const body = `${marker}\n${renderBundleMarkdown(head, base)}\nBase ${commit(base.metadata.sha)} → head ${commit(head.metadata.sha)} · [Build and artifacts](https://github.com/${repo}/actions/runs/${run.id}/attempts/${run.run_attempt})\n`;
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, body);
console.log(
  await postReportComment({
    api,
    pr: pr.number,
    run,
    body,
    marker,
    family: "<!-- tracepilot-bundle-report:",
  }),
);
