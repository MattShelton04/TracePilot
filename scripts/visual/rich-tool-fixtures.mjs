import { claudeGallerySessionId } from "../fixtures/claude-gallery.mjs";
import {
  claudeToolSamples,
  fixtureTime,
  richToolSamples,
  richToolsSessionId,
  richToolTurn,
} from "../fixtures/rich-tools.mjs";

/** Return undefined for commands owned by the existing shared mock corpus. */
export function richToolFixture(cmd, args, sampleId) {
  if (args?.sessionId !== richToolsSessionId && args?.sessionId !== claudeGallerySessionId)
    return undefined;
  const sample = [...richToolSamples, ...claudeToolSamples].find((item) => item.id === sampleId);
  if (!sample) throw new Error(`Unknown rich tool fixture: ${sampleId}`);
  if (cmd === "get_session_detail")
    return {
      id: args.sessionId,
      ...(sample.nativeToolName ? { source: "claudeCode" } : {}),
      summary: sample.nativeToolName
        ? "SYNTHETIC · Claude Code renderer gallery"
        : "SYNTHETIC · Rich tool renderer gallery",
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
  // get_session_turns applies the native UTF-8 preview boundary. Fetching must
  // return the canonical complete result so interaction captures exercise a
  // real replacement, including the completed-empty-string contract.
  if (cmd === "get_tool_result") return sample.content;
  if (cmd === "get_session_prompt_cache")
    return { timeline: null, eventsFileSize: 1024, eventsFileMtime: Date.parse(fixtureTime) };
  if (cmd === "get_session_incidents") return [];
  return undefined;
}
