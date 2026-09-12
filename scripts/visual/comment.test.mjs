import assert from "node:assert/strict";
import test from "node:test";
import { buildComment, commentMarker, updateComment } from "./comment.mjs";

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

test("sticky comment scans all pages, updates one canonical bot comment and only removes owned duplicates", async () => {
  const first = [
    own(12),
    ...Array.from({ length: 99 }, (_, id) => ({
      id: id + 100,
      body: commentMarker,
      user: { login: "human" },
    })),
  ];
  const second = [own(42), { ...own(8), user: { login: "another-bot[bot]" } }];
  const calls = [];
  const api = async (path, options) => {
    calls.push([path, options]);
    if (path === "/pulls/7") return { state: "open", head: { sha: run.head_sha } };
    if (path.endsWith("&page=1")) return first;
    if (path.endsWith("&page=2")) return second;
    return {};
  };
  assert.equal(await updateComment({ api, pr: 7, run, body: "updated" }), "updated");
  assert.deepEqual(
    calls.filter(([, options]) => options).map(([path, options]) => [path, options.method]),
    [
      ["/issues/comments/12", "PATCH"],
      ["/issues/comments/42", "DELETE"],
    ],
  );
});

test("older reruns and superseded heads leave the latest comment untouched", async () => {
  for (const scenario of ["head", "attempt", "run", "head-during-pagination"]) {
    let reads = 0;
    const writes = [];
    const api = async (path, options) => {
      if (options) writes.push(options);
      if (path === "/pulls/7")
        return {
          state: "open",
          head: {
            sha:
              scenario === "head" || (scenario === "head-during-pagination" && reads++ > 0)
                ? "b".repeat(40)
                : run.head_sha,
          },
        };
      return [
        own(
          12,
          `${commentMarker}\n<!-- tracepilot-visual-report:run=${scenario === "run" ? 999 : 123};attempt=${scenario === "attempt" ? 3 : 2};sha=${run.head_sha} -->`,
        ),
      ];
    };
    assert.ok(
      ["stale-head", "newer-report"].includes(
        await updateComment({ api, pr: 7, run, body: "old" }),
      ),
    );
    assert.equal(writes.length, 0, scenario);
  }
});
