import { vi } from "vitest";
import { nextTick } from "vue";

const hoistedMocks = vi.hoisted(() => ({
  searchContent: vi.fn(),
  getSearchFacets: vi.fn(),
  getSearchStats: vi.fn(),
  getSearchRepositories: vi.fn(),
  getSearchToolNames: vi.fn(),
  rebuildSearchIndex: vi.fn(),
  ftsIntegrityCheck: vi.fn(),
  ftsOptimize: vi.fn(),
  ftsHealth: vi.fn(),
  logWarn: vi.fn(),
}));

export const mocks = hoistedMocks;

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    searchContent: (...args: unknown[]) => hoistedMocks.searchContent(...args),
    getSearchFacets: (...args: unknown[]) => hoistedMocks.getSearchFacets(...args),
    getSearchStats: (...args: unknown[]) => hoistedMocks.getSearchStats(...args),
    getSearchRepositories: (...args: unknown[]) => hoistedMocks.getSearchRepositories(...args),
    getSearchToolNames: (...args: unknown[]) => hoistedMocks.getSearchToolNames(...args),
    rebuildSearchIndex: (...args: unknown[]) => hoistedMocks.rebuildSearchIndex(...args),
    ftsIntegrityCheck: (...args: unknown[]) => hoistedMocks.ftsIntegrityCheck(...args),
    ftsOptimize: (...args: unknown[]) => hoistedMocks.ftsOptimize(...args),
    ftsHealth: (...args: unknown[]) => hoistedMocks.ftsHealth(...args),
  });
});

vi.mock("@/utils/tauriEvents", () => ({
  safeListen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@/utils/logger", () => ({
  logWarn: (...args: unknown[]) => hoistedMocks.logWarn(...args),
}));

export const emptySearchResponse = {
  results: [],
  totalCount: 0,
  hasMore: false,
  latencyMs: 5,
};

export const emptyFacets = {
  byContentType: [],
  byRepository: [],
  byToolName: [],
  totalMatches: 0,
  sessionCount: 0,
};

export function resetAllMocks() {
  for (const mock of Object.values(hoistedMocks)) mock.mockReset();
}

export function setupDefaultMocks() {
  hoistedMocks.searchContent.mockResolvedValue(emptySearchResponse);
  hoistedMocks.getSearchFacets.mockResolvedValue(emptyFacets);
  hoistedMocks.getSearchStats.mockResolvedValue({
    totalRows: 0,
    indexedSessions: 0,
    totalSessions: 0,
    contentTypeCounts: [],
  });
  hoistedMocks.getSearchRepositories.mockResolvedValue([]);
  hoistedMocks.getSearchToolNames.mockResolvedValue([]);
  hoistedMocks.rebuildSearchIndex.mockResolvedValue(undefined);
  hoistedMocks.ftsIntegrityCheck.mockResolvedValue("ok");
  hoistedMocks.ftsOptimize.mockResolvedValue("ok");
  hoistedMocks.ftsHealth.mockResolvedValue(null);
}

export async function flushSearchQueue() {
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
