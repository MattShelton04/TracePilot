import assert from "node:assert/strict";
import test from "node:test";
import { richToolSamples, richToolsSessionId } from "../fixtures/rich-tools.mjs";
import { cases } from "./manifest.mjs";
import { richToolFixture } from "./rich-tool-fixtures.mjs";

test("lazy full-result fixtures return canonical output distinct from the preview", () => {
  const args = { sessionId: richToolsSessionId };
  for (const sample of richToolSamples.filter((item) =>
    item.actions?.some((action) => action.type === "full"),
  )) {
    const initial = richToolFixture("get_session_turns", args, sample.id).turns[0].toolCalls[0]
      .resultContent;
    const complete = richToolFixture("get_tool_result", args, sample.id);
    assert(initial.endsWith("…[truncated]"), `${sample.id} is missing a real preview`);
    assert.notEqual(initial, complete);
    assert.equal(complete, sample.content);
  }
});

test("long result families cover both initial and explicit expanded or fetched states", () => {
  for (const family of ["view", "powershell", "sql", "web_search", "read_agent", "fixture_tool"]) {
    const samples = richToolSamples.filter((sample) => sample.toolName === family);
    assert(
      samples.some((sample) => !sample.actions),
      `${family} needs an initial case`,
    );
    assert(
      samples.some((sample) => sample.actions?.length),
      `${family} needs an interactive case`,
    );
  }
  for (const sample of richToolSamples.filter((item) => item.actions?.length)) {
    const visual = cases.find((item) => item.fixture === sample.id);
    assert.deepEqual(visual.actions, sample.actions);
    assert(visual.state.includes(sample.viewState));
  }
  assert.equal(richToolFixture("get_session_turns", { sessionId: "unrelated" }, "sql"), undefined);
  assert.throws(
    () => richToolFixture("get_session_turns", { sessionId: richToolsSessionId }, "missing"),
    /Unknown rich tool fixture/,
  );
});
