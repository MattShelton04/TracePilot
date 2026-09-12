import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cliCompatibleFixtureEvents } from "./usability-event-fixtures.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const load = async (name) =>
  (
    await readFile(
      new URL(`../../crates/tracepilot-core/tests/fixtures/versions/${name}`, import.meta.url),
      "utf8",
    )
  )
    .trim()
    .split("\n")
    .map(JSON.parse);

test("new rich audit events satisfy the CLI 1.0.83 envelope contract and preserve parent relationships", async () => {
  const source = await load("v1_0_83_multiturn.jsonl");
  source[0].data.context = { cwd: "C:\\audit", hostType: "cli" };
  const original = structuredClone(source);
  const events = cliCompatibleFixtureEvents(source);
  assert.deepEqual(source, original, "Normalization must not mutate shared historical fixtures");
  assert.equal(events.length, 40);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  for (const [index, event] of events.entries()) {
    assert.match(event.id, uuid);
    assert.equal(event.type, source[index].type);
    assert.equal(event.timestamp, source[index].timestamp);
    assert.equal(event.data.content, source[index].data.content);
    assert.equal(event.agentId, source[index].agentId);
    const parent = source.findIndex((item) => item.id === source[index].parentId);
    assert.equal(event.parentId, parent === -1 ? null : events[parent].id);
    if (event.type === "system.message") assert.equal(event.data.role, "system");
    if (event.type === "assistant.message") assert.match(event.data.messageId, uuid);
  }
  assert.equal(events[0].data.version, 3);
  assert.equal(events[0].data.producer, "audit-fixture");
  assert.equal(events[0].data.context.hostType, "github");
});

test("legacy fixtures retain their version/producer and populated metadata while gaining UUID envelopes", async () => {
  const source = await load("v1_0_24.jsonl");
  const events = cliCompatibleFixtureEvents(source);
  assert.equal(events[0].data.version, 1);
  assert.equal(events[0].data.producer, "copilot-agent");
  assert.equal(events[0].data.copilotVersion, "1.0.24");
  const preserved = cliCompatibleFixtureEvents([
    {
      id: "start",
      parentId: null,
      type: "session.start",
      data: { version: 2, producer: "custom", context: { hostType: "ado" } },
    },
    {
      id: "system",
      parentId: "start",
      type: "system.message",
      data: { role: "developer", content: "rules" },
    },
    {
      id: "message",
      parentId: "system",
      type: "assistant.message",
      data: { messageId: "existing-message", content: "text" },
    },
  ]);
  assert.equal(preserved[0].data.context.hostType, "ado");
  assert.equal(preserved[1].data.role, "developer");
  assert.equal(preserved[2].data.messageId, "existing-message");
  assert.deepEqual(cliCompatibleFixtureEvents([]), []);
});

test("invalid parent graphs fail instead of silently dropping their relationships", () => {
  const event = { id: "one", parentId: null, type: "user.message", data: { content: "fixture" } };
  assert.throws(() => cliCompatibleFixtureEvents([event, event]), /Duplicate fixture event ID/);
  assert.throws(
    () => cliCompatibleFixtureEvents([{ ...event, parentId: "missing" }]),
    /Missing fixture parent/,
  );
});
