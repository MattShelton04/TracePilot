import type {
  importSessions as importSessionsCommand,
  previewImport as previewImportCommand,
} from "@tracepilot/client";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, vi } from "vitest";
import type { logError as logErrorFunction, logInfo as logInfoFunction } from "@/utils/logger";
import { useImportFlow } from "../../../composables/useImportFlow";

const hoistedMocks = vi.hoisted(() => ({
  importSessions: vi.fn<typeof importSessionsCommand>(),
  logError: vi.fn<typeof logErrorFunction>(),
  logInfo: vi.fn<typeof logInfoFunction>(),
  previewImport: vi.fn<typeof previewImportCommand>(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    importSessions: hoistedMocks.importSessions,
    previewImport: hoistedMocks.previewImport,
  });
});

vi.mock("@/utils/logger", () => ({
  logError: hoistedMocks.logError,
  logInfo: hoistedMocks.logInfo,
}));

export const client = {
  importSessions: hoistedMocks.importSessions,
  previewImport: hoistedMocks.previewImport,
};

export const logger = {
  logError: hoistedMocks.logError,
  logInfo: hoistedMocks.logInfo,
};

export type ImportFlow = ReturnType<typeof useImportFlow>;

const mountedWrappers: VueWrapper[] = [];

export function mountImportFlow(): ImportFlow {
  let flowRef!: ImportFlow;

  const Wrapper = {
    setup() {
      flowRef = useImportFlow();
      return {};
    },
    template: "<div />",
  };

  const wrapper = mount(Wrapper);
  mountedWrappers.push(wrapper);
  return flowRef;
}

export function setupUseImportFlowTest(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  afterEach(() => {
    mountedWrappers.splice(0).forEach((wrapper) => {
      wrapper.unmount();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
}
