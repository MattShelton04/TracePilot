import type { ContextCaptureSnapshot } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextCaptureViewer from "@/components/contextCapture/ContextCaptureViewer.vue";

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
      captureScope: "session",
      captureInputSha256: null,
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
  it("explains the client request boundary and shows an estimated token breakdown", () => {
    const wrapper = mount(ContextCaptureViewer, {
      props: { snapshot: fixture() },
    });
    expect(wrapper.text()).toContain("exact HTTP request body emitted by Copilot CLI");
    expect(wrapper.text()).toContain("not the model's final internal token stream");
    expect(wrapper.text()).toContain("Estimated tokens");
    expect(wrapper.text()).toContain("System instructions");
    expect(wrapper.text()).toContain("Est. tokens");
    expect(wrapper.find('[aria-label="Copy JSON"]').exists()).toBe(true);
    expect(wrapper.find(".fcv__file-header").exists()).toBe(false);
  });

  it("keeps the synthetic probe visible and explicitly marked", async () => {
    const wrapper = mount(ContextCaptureViewer, {
      props: { snapshot: fixture() },
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Request items"))
      ?.trigger("click");
    expect(wrapper.text()).toContain("Synthetic capture probe");
    const detail = wrapper.find("details");
    (detail.element as HTMLDetailsElement).open = true;
    await detail.trigger("toggle");
    expect(wrapper.text()).toContain("TracePilot context capture nonce");
    expect(wrapper.find('[aria-label="Copy JSON"]').exists()).toBe(true);
  });

  it("uses the standard direct copy action for the exact raw body", async () => {
    const wrapper = mount(ContextCaptureViewer, {
      props: { snapshot: fixture() },
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("Raw JSON"))
      ?.trigger("click");

    expect(wrapper.text()).toContain("Raw preserves the captured byte and property order");
    expect(wrapper.find('[aria-label="Copy JSON"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Copy sensitive request JSON");
  });
});
