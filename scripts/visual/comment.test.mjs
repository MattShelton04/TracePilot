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

const hash = (char) => `${char.repeat(64)}.png`;
const changedRow = (id, changed, review = {}) => ({
  id,
  route: "/",
  state: "populated",
  change: "changed",
  analyses: { 0: { changed, percent: (100 * changed) / 1_382_400, regionCount: 1 } },
  review: {
    areas: [{ x: 10, y: 20, width: 30, height: 40, pixels: changed }],
    areaCount: 1,
    difference: hash("d"),
    focus: [
      {
        area: { x: 10, y: 20, width: 30, height: 40, pixels: changed },
        base: hash("b"),
        head: hash("c"),
      },
    ],
    ...review,
  },
});

test("comment describes the whole PR and shows difference images and 1:1 close-ups, largest first", () => {
  const rows = [
    changedRow("small", 50),
    changedRow("large", 5000, { sharedWith: ["twin"] }),
    changedRow("twin", 5000, { sameAs: "large" }),
  ];
  const body = buildComment({ ...args, rows, baseSha: "b".repeat(40) });
  assert.match(body, /\*\*Whole PR:\*\* base \[bbbbbbbb\]/);
  assert.match(body, /updated in place/);
  assert.match(body, /attempt 2/);
  assert.ok(body.indexOf("#### large") < body.indexOf("#### small"));
  assert.match(body, /5,000 px changed \(0\.36%\) in 1 area/);
  assert.ok(body.includes(`owner.github.io/repo/visual/img/${"d".repeat(64)}.png`));
  assert.match(body, /\| Before \| After \|/);
  assert.ok(body.includes(`img/${"c".repeat(64)}.png`));
  assert.match(body, /Largest area\*\* at 10,20 \(30×40\)/);
  // A view repeating another view's changed areas is folded into it.
  assert.equal(body.includes("#### twin"), false);
  assert.match(body, /Same changed areas in 1 other view: \[twin\]/);
  assert.match(body, /view=small&mode=difference/);
  assert.match(body, /changes\.json/);
  assert.match(body, /visual\/index.html/);
});

test("only the largest changes are expanded; the rest stay collapsed and bounded", () => {
  const rows = Array.from({ length: 33 }, (_, index) => changedRow(`view-${index}`, 1000 - index));
  const body = buildComment({ ...args, rows });
  assert.equal((body.match(/^#### /gm) ?? []).length, 3);
  assert.equal((body.match(/<details><summary><b>/g) ?? []).length, 30);
  assert.match(body, /view=view-32&mode=difference/);
});

test("large comments remain bounded, escape artifact HTML and explain omitted screenshots", () => {
  const rows = Array.from({ length: 128 }, (_, index) => ({
    ...changedRow(`view-${index}`, 200),
    route: `/${"x".repeat(300)}`,
    state: `<script>${"&".repeat(300)}`,
  }));
  const body = buildComment({ ...args, rows });
  assert.ok(Buffer.byteLength(body, "utf8") < 60_001);
  assert.match(body, /additional changed views/);
  assert.equal(body.includes("<script>"), false);
  assert.match(body, /&lt;script&gt;/);
  assert.match(
    buildComment({ ...args, rows: [], galleryUrl: undefined }),
    /Pages publication is unavailable/,
  );
});

test("subtle differences are reported separately, never called identical or silently omitted", () => {
  const body = buildComment({
    ...args,
    summary: { ...summary, changed: 0, subtle: 1 },
    rows: [{ id: "sessions", change: "subtle", analyses: { 0: { changed: 11 } } }],
  });
  assert.match(body, /1 view has subtle pixel differences/);
  assert.match(body, /sessions&mode=difference\) · 11 px/);
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
