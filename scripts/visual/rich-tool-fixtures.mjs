import {
  fixtureTime,
  richToolSamples,
  richToolsSessionId,
  richToolTurn,
} from "../fixtures/rich-tools.mjs";

/** Return undefined for commands owned by the existing shared mock corpus. */
export function richToolFixture(cmd, args, sampleId) {
  if (args?.sessionId !== richToolsSessionId) return undefined;
  const sample = richToolSamples.find((item) => item.id === sampleId);
  if (!sample) throw new Error(`Unknown rich tool fixture: ${sampleId}`);
  if (cmd === "get_session_detail")
    return {
      id: richToolsSessionId,
      summary: "SYNTHETIC · Rich tool renderer gallery",
      repository: "example/orchard",
      branch: "fixture/rich-tools",
      cwd: "C:/synthetic/orchard",
      hostType: "github",
      eventCount: 6,
      turnCount: 1,
      hasPlan: false,
      hasCheckpoints: false,
      checkpointCount: 0,
      createdAt: fixtureTime,
      updatedAt: fixtureTime,
    };
  if (cmd === "get_session_turns")
    return {
      turns: [richToolTurn(sample)],
      eventsFileSize: 1024,
      eventsFileMtime: Date.parse(fixtureTime),
    };
  if (cmd === "get_tool_result") return sample.content;
  if (cmd === "get_session_prompt_cache")
    return { timeline: null, eventsFileSize: 1024, eventsFileMtime: Date.parse(fixtureTime) };
  if (cmd === "get_session_incidents") return [];
  return undefined;
}
