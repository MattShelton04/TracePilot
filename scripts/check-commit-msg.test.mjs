import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { isValidCommitMessage } from "./check-commit-msg.mjs";

test("conventional commits of every listed type are accepted", () => {
  for (const message of [
    "feat: add search",
    "fix(search): keep the query",
    "revert: undo the search change",
    "revert(ui): drop the banner",
    "build(deps): bump vite\n\nLonger body.",
  ])
    assert.ok(isValidCommitMessage(message), message);
});

test("git's default merge and revert messages are accepted", () => {
  for (const message of [
    "Merge branch 'main' into agent/search",
    "Merge pull request #1062 from user/branch",
    "Merge remote-tracking branch 'origin/main'",
    "Merge commit 'abc1234'",
    "Merge branches 'a' and 'b'",
    "Merge tag 'v0.9.2'",
    'Revert "feat: add search"\n\nThis reverts commit abc1234.',
    'Reapply "feat: add search"',
    "Merge branch 'main'\n\n# Please enter a commit message to explain why this merge is necessary,",
  ])
    assert.ok(isValidCommitMessage(message), message);
});

test("everything else is still rejected", () => {
  for (const message of [
    "",
    "add search",
    "Feat: add search",
    "feature: add search",
    "fix:no space",
    "fix: ",
    "Merge",
    "merge branch 'main'",
    "Merged the branch",
    "Revert the search change",
    'Revert ""',
    "Merge fixes from today",
    "Merge resume-and-picker workstream",
    'Revert "x" and also a bunch of new stuff',
    "wip",
  ])
    assert.ok(!isValidCommitMessage(message), JSON.stringify(message));
});

test("the hook exits 1 with guidance for a rejected message and 0 for an accepted one", () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), "check-commit-msg.mjs");
  const dir = mkdtempSync(join(tmpdir(), "tracepilot-commit-msg-"));
  try {
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, 'Revert "fix: x"\n');
    execFileSync(process.execPath, [script, file], { stdio: "pipe" });
    writeFileSync(file, "update things\n");
    assert.throws(
      () => execFileSync(process.execPath, [script, file], { stdio: "pipe" }),
      (error) => error.status === 1 && /Types: .*revert/.test(String(error.stderr)),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
