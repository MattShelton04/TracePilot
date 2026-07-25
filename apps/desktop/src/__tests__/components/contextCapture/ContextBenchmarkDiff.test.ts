import type { ContextCaptureSnapshot } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextBenchmarkDiff from "@/components/contextCapture/ContextBenchmarkDiff.vue";

function snapshot(systemText: string, toolDescription: string): ContextCaptureSnapshot {
  const rawBody = JSON.stringify({
    model: "gpt-5",
    instructions: systemText,
    input: [],
    tools: [
      {
        type: "function",
        name: "shell",
        description: toolDescription,
        parameters: { type: "object" },
      },
    ],
    stream: true,
  });
  return {
    rawBody,
    manifest: {
      schemaVersion: 2,
      captureId: crypto.randomUUID(),
      sourceSessionId: "00000000-0000-4000-8000-000000000001",
      capturedAt: "2026-07-25T00:00:00Z",
      sourceEventsFingerprint: { bytes: 0, modifiedUnixMs: 0, sha256: "input" },
      cliVersion: "1.0.71",
      captureProfile: "current-environment",
      captureScope: "repositoryBenchmark",
      repositoryPath: "C:\\repo",
      captureInputSha256: "input",
      protocol: "openAiResponses",
      protocolDetectionSource: "benchmark selection",
      requestPath: "/nonce/v1/responses",
      contentType: "application/json",
      rawBodySha256: "body",
      rawBodyBytes: rawBody.length,
      rawBodyCharacters: rawBody.length,
      estimatedTokens: Math.ceil(rawBody.length / 4),
      probeNonce: "nonce",
      fidelityManifest: {
        profile: "current-environment",
        includedResources: [],
        omittedResources: [],
        workingDirectory: "C:\\repo",
        workingDirectoryFallback: false,
        sourceUnchanged: true,
      },
      warnings: [],
      safeHeaderNames: ["content-type"],
      saved: true,
      parsed: {
        model: "gpt-5",
        systemBlocks: [
          {
            index: 0,
            source: "instructions",
            content: systemText,
            bytes: systemText.length,
            characters: systemText.length,
            containsProbe: false,
          },
        ],
        messages: [],
        toolDefinitions: [
          {
            index: 0,
            name: "shell",
            description: toolDescription,
            schema: { type: "object" },
            raw: {
              type: "function",
              name: "shell",
              description: toolDescription,
              parameters: { type: "object" },
            },
            bytes: toolDescription.length,
            characters: toolDescription.length,
          },
        ],
        requestControls: { stream: true },
        attachments: [],
        probeMessageIndices: [],
        unknownFields: {},
        sectionMetrics: {
          systemBytes: systemText.length,
          systemCharacters: systemText.length,
          messageBytes: 0,
          messageCharacters: 0,
          toolBytes: toolDescription.length,
          toolCharacters: toolDescription.length,
          controlsBytes: 15,
          controlsCharacters: 15,
        },
        warnings: [],
      },
    },
  };
}

describe("ContextBenchmarkDiff", () => {
  it("renders the actual removed and added system instruction lines", () => {
    const wrapper = mount(ContextBenchmarkDiff, {
      props: {
        before: snapshot("Keep responses concise.\nNever edit generated files.", "Run a command"),
        after: snapshot("Keep responses concise.\nAsk before editing files.", "Run a command"),
      },
    });

    expect(wrapper.text()).toContain("Never edit generated files.");
    expect(wrapper.text()).toContain("Ask before editing files.");
    expect(wrapper.find('[aria-label="removed"]').text()).toContain("Never edit generated files.");
    expect(wrapper.find('[aria-label="added"]').text()).toContain("Ask before editing files.");
  });

  it("keeps changed tool details available in an expandable field-level diff", async () => {
    const wrapper = mount(ContextBenchmarkDiff, {
      props: {
        before: snapshot("System", "Run a command"),
        after: snapshot("System", "Run a safe command"),
      },
    });
    const details = wrapper.find("details");

    expect(details.exists()).toBe(true);
    (details.element as HTMLDetailsElement).open = true;
    await details.trigger("toggle");
    expect(details.text()).toContain("Run a command");
    expect(details.text()).toContain("Run a safe command");
  });
});
