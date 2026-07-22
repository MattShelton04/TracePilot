import type { ContextCaptureSnapshot } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ContextCaptureViewer from "@/components/contextCapture/ContextCaptureViewer.vue";

vi.mock("@tracepilot/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tracepilot/ui")>();
  return {
    ...actual,
    ModalDialog: {
      props: ["visible", "title"],
      template: '<div v-if="visible"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
    },
  };
});

function fixture(): ContextCaptureSnapshot {
  return {
    rawBody: '{"model":"gpt-5","input":[]}',
    manifest: {
      schemaVersion: 1,
      captureId: "11111111-1111-4111-8111-111111111111",
      sourceSessionId: "22222222-2222-4222-8222-222222222222",
      capturedAt: "2026-07-22T09:00:00Z",
      sourceEventsFingerprint: { bytes: 100, modifiedUnixMs: 1, sha256: "source-hash" },
      cliVersion: "1.0.71",
      captureProfile: "isolated",
      protocol: "openAiResponses",
      protocolDetectionSource: "assistant.usage API endpoint",
      requestPath: "/nonce/v1/responses",
      contentType: "application/json",
      rawBodySha256: "body-hash",
      rawBodyBytes: 28,
      rawBodyCharacters: 28,
      estimatedTokens: 7,
      probeNonce: "nonce",
      fidelityManifest: {
        profile: "isolated",
        includedResources: ["session"],
        omittedResources: ["credentials"],
        workingDirectory: "C:\\repo",
        workingDirectoryFallback: false,
        sourceUnchanged: true,
      },
      warnings: ["A synthetic probe was appended after an isolated resume boundary."],
      safeHeaderNames: ["content-type"],
      saved: true,
      parsed: {
        model: "gpt-5",
        systemBlocks: [],
        messages: [
          {
            index: 0,
            role: "user",
            itemType: "message",
            content: "[TracePilot context capture nonce]",
            raw: { role: "user", content: "[TracePilot context capture nonce]" },
            bytes: 60,
            characters: 60,
            isProbe: true,
          },
        ],
        toolDefinitions: [],
        requestControls: { stream: true },
        attachments: [],
        probeMessageIndices: [0],
        unknownFields: {},
        sectionMetrics: {
          systemBytes: 0,
          systemCharacters: 0,
          messageBytes: 60,
          messageCharacters: 60,
          toolBytes: 0,
          toolCharacters: 0,
          controlsBytes: 15,
          controlsCharacters: 15,
        },
        warnings: [],
      },
    },
  };
}

describe("ContextCaptureViewer", () => {
  it("states the capture-run truth boundary and labels token counts as estimated", () => {
    const wrapper = mount(ContextCaptureViewer, {
      props: { visible: true, snapshot: fixture() },
    });
    expect(wrapper.text()).toContain("Exact captured payload · Capture run only");
    expect(wrapper.text()).toContain("Estimated tokens");
    expect(wrapper.text()).toContain("source unchanged");
    expect(wrapper.text()).toContain("A synthetic probe was appended");
  });

  it("keeps the synthetic probe visible and explicitly marked", async () => {
    const wrapper = mount(ContextCaptureViewer, {
      props: { visible: true, snapshot: fixture() },
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Messages"))
      ?.trigger("click");
    expect(wrapper.text()).toContain("synthetic capture probe");
    expect(wrapper.text()).toContain("TracePilot context capture nonce");
  });
});
