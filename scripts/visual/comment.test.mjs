import assert from "node:assert/strict";
import test from "node:test";
import { buildComment, commentMarker, postComment } from "./comment.mjs";

const run = { id: 123, run_attempt: 2, head_sha: "a".repeat(40) };
const summary = { changed: 33, unchanged: 0, baseUnavailable: 0, incomplete: 0 };
const args = {
  run,
  summary,
  repo: "owner/repo",
  galleryUrl: "https://owner.github.io/repo/visual/runs/123/",
  publisherRunId: 456,
};
const own = (id, body = commentMarker) => ({ id, body, user: { login: "github-actions[bot]" } });

test("comment embeds every ordinary changed pair and identifies the commit, rerun, difference viewer and history", () => {
  const rows = Array.from({ length: 33 }, (_, index) => ({
    id: `view-${index}`,
    route: "/",
    state: "populated",
    change: "changed",
  }));
  const body = buildComment({ ...args, rows });
  assert.equal((body.match(/<details>/g) ?? []).length, 33);
  assert.match(body, /attempt 2/);
  assert.match(body, /base-view-0.png\?attempt=2/);
  assert.match(body, /view=view-32&mode=difference/);
  assert.match(body, /visual\/index.html/);
  assert.match(body, /aaaaaaaa/);
});

test("large comments remain bounded, escape artifact HTML and explain omitted screenshots", () => {
  const rows = Array.from({ length: 128 }, (_, index) => ({
    id: `view-${index}`,
    route: `/${"x".repeat(300)}`,
    state: `<script>${"&".repeat(300)}`,
    change: "changed",
  }));
  const body = buildComment({ ...args, rows });
  assert.ok(Buffer.byteLength(body, "utf8") < 60_001);
  assert.match(body, /additional changed views/);
  assert.equal(body.includes("<script>"), false);
  assert.match(body, /<code>&lt;script&gt;/);
  assert.match(
    buildComment({ ...args, rows: [], galleryUrl: undefined }),
    /Pages publication is unavailable/,
  );
});

test("subtle differences are reported separately, never called identical or silently omitted", () => {
  const body = buildComment({
    ...args,
    summary: { ...summary, changed: 0, subtle: 1 },
    rows: [{ id: "sessions", change: "subtle" }],
  });
  assert.match(body, /1 view has subtle pixel differences/);
  assert.match(body, /at most 128 pixels/);
  assert.match(body, /view=sessions&mode=difference/);
  assert.equal(body.includes("No paired pixel changes"), false);
});

test("incomplete baselines do not claim no changes", () => {
  const body = buildComment({
    ...args,
    rows: [],
    baseSha: "b".repeat(40),
    summary: { changed: 0, unchanged: 0, baseUnavailable: 36, incomplete: 0 },
  });
  assert.match(body, /Comparison incomplete/);
  assert.match(body, /bbbbbbbb/);
  assert.equal(body.includes("No larger"), false);
});

test("visual reports create one sticky comment per PR", async () => {
  const writes = [];
  const api = async (path, options) => {
    if (options) {
      writes.push([path, options.method]);
      return {};
    }
    if (path === "/pulls/7") return { state: "open", head: { sha: run.head_sha } };
    if (path === "/actions/runs/123") return run;
    return [own(12)];
  };
  assert.equal(await postComment({ api, pr: 7, run, body: "report" }), "updated");
  assert.deepEqual(writes, [["/issues/comments/12", "PATCH"]]);
});
