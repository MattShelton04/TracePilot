import assert from "node:assert/strict";
import test from "node:test";
import { postReportComment } from "./report-comment.mjs";

const run = { id: 123, run_attempt: 2, head_sha: "a".repeat(40) };
const marker = "<!-- test-report:123:2 -->";
const family = "<!-- test-report -->";
const own = (body, id = 1) => ({ id, body, user: { login: "github-actions[bot]" } });
function fixture({ pages = [[]], stale = false, moved = false, attempt = 2 } = {}) {
  const writes = [];
  let reads = 0;
  const api = async (path, options) => {
    if (options) {
      writes.push([path, options]);
      return {};
    }
    if (path === "/pulls/7")
      return {
        state: "open",
        head: { sha: stale || (moved && reads++ > 0) ? "b".repeat(40) : run.head_sha },
      };
    if (path === "/actions/runs/123") return { run_attempt: attempt };
    return pages[Number(/page=(\d+)$/.exec(path)[1]) - 1];
  };
  return {
    writes,
    call: () =>
      postReportComment({ api, pr: 7, run, body: `${family}${marker}\nReport`, marker, family }),
  };
}
test("the first report creates one comment", async () => {
  const { call, writes } = fixture({ pages: [[own("unrelated bot comment")]] });
  assert.equal(await call(), "created");
  assert.deepEqual(
    writes.map(([path, options]) => [path, options.method]),
    [["/issues/7/comments", "POST"]],
  );
});
test("later revisions edit the newest report instead of appending incremental comments", async () => {
  const human = { id: 9, body: family, user: { login: "human" } };
  const { call, writes } = fixture({
    pages: [[own(`${family} old`, 3), human, own(`${family} newer`, 5)]],
  });
  assert.equal(await call(), "updated");
  assert.deepEqual(
    writes.map(([path, options]) => [path, options.method]),
    [["/issues/comments/5", "PATCH"]],
  );
  assert.match(JSON.parse(writes[0][1].body).body, /Report/);
});
test("duplicate deliveries are idempotent across pages and only bot markers count", async () => {
  const first = Array.from({ length: 100 }, () => ({ body: marker, user: { login: "human" } }));
  const duplicate = fixture({ pages: [first, [own(marker)]] });
  assert.equal(await duplicate.call(), "already-posted");
  assert.equal(duplicate.writes.length, 0);
  assert.equal(await fixture({ pages: [first, []] }).call(), "created");
});
test("stale heads, heads moving during pagination and superseded attempts cannot post", async () => {
  for (const options of [{ stale: true }, { moved: true }, { attempt: 3 }]) {
    const { call, writes } = fixture(options);
    assert.match(await call(), /^stale-/);
    assert.equal(writes.length, 0);
  }
});
