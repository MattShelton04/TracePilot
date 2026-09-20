import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function comparisonRefs(event, eventName, sha, git) {
  const head = event.pull_request?.head.sha ?? sha;
  let base = event.pull_request?.base.sha ?? event.before;
  assert(/^[a-f0-9]{40}$/.test(head), "Invalid head SHA");
  if (eventName === "pull_request") {
    assert(/^[a-f0-9]{40}$/.test(base), "Invalid base SHA");
    base = git(["merge-base", base, head]);
  } else if (!base || /^0+$/.test(base)) {
    // Manual runs and initial pushes compare against the first parent, never self.
    base = git(["rev-parse", `${head}^`]);
  }
  assert(
    /^[a-f0-9]{40}$/.test(base) && base !== head,
    "Comparison requires distinct base and head commits",
  );
  return { base, head };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const refs = comparisonRefs(
    event,
    process.env.GITHUB_EVENT_NAME,
    process.env.GITHUB_SHA,
    (args) =>
      execFileSync("git", ["-C", process.argv[2] ?? ".", ...args], { encoding: "utf8" }).trim(),
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `base=${refs.base}\nhead=${refs.head}\n`);
  console.log(`Comparison: ${refs.base} → ${refs.head}`);
}
