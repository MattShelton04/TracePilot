import type { CapturePreflight } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ContextCapturePreflight from "@/components/contextCapture/ContextCapturePreflight.vue";

function fixture(overrides: Partial<CapturePreflight> = {}): CapturePreflight {
  return {
    sourceSessionId: "11111111-1111-4111-8111-111111111111",
    inactive: true,
    sourceSizeBytes: 1024,
    sourceFileCount: 2,
    storageWritable: true,
    sourceEventsFingerprint: { bytes: 100, modifiedUnixMs: 1, sha256: "hash" },
    workingDirectory: "C:\\repo",
    workingDirectoryExists: true,
    cli: {
      executable: "copilot",
      version: "1.0.71",
      supportsResume: true,
      supportsPrompt: true,
      supportsJsonOutput: true,
      supportsOffline: true,
      supportsByokRouting: true,
      supportsRequiredSafetyFlags: true,
      missingCapabilities: [],
    },
    sourceCliVersion: "1.0.71",
    model: "gpt-5",
    protocol: "openAiResponses",
    protocolDetectionSource: "model-family compatibility fallback",
    protocolOptions: ["openAiResponses", "openAiChatCompletions", "anthropicMessages"],
    captureProfile: "isolated",
    includedResources: ["session files"],
    omittedResources: ["credentials"],
    warnings: ["No persisted model API endpoint was found."],
    canCapture: true,
    ...overrides,
  };
}

describe("ContextCapturePreflight", () => {
  it("keeps non-actionable implementation details out of the primary workflow", () => {
    const wrapper = mount(ContextCapturePreflight, {
      props: { preflight: fixture(), protocol: "openAiResponses", save: false },
    });

    expect(wrapper.text()).toContain("API request format");
    expect(wrapper.text()).toContain("Capture request");
    expect(wrapper.text()).not.toContain("No persisted model API endpoint");
    expect(wrapper.text()).not.toContain("session files");
    expect(wrapper.text()).not.toContain("credentials");
  });

  it("shows actionable blockers", () => {
    const wrapper = mount(ContextCapturePreflight, {
      props: {
        preflight: fixture({ inactive: false, canCapture: false }),
        protocol: "openAiResponses",
        save: false,
      },
    });

    expect(wrapper.text()).toContain("Capture cannot start");
    expect(wrapper.text()).toContain("Close the source Copilot CLI session");
  });
});
