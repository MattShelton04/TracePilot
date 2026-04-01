import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, reactive, ref } from "vue";
import SessionReplayView from "../../views/SessionReplayView.vue";

const mockRouterPush = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "session-1" } }),
  useRouter: () => ({ push: mockRouterPush }),
}));

const sessionsStore = { sessions: [] as Array<unknown>, loading: false, fetchSessions: vi.fn() };
vi.mock("@/stores/sessions", () => ({
  useSessionsStore: () => sessionsStore,
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isRichRenderingEnabled: true,
    isFeatureEnabled: () => true,
  }),
}));

vi.mock("@/composables/useToolResultLoader", () => ({
  useToolResultLoader: () => ({
    fullResults: {},
    loadingResults: new Set<string>(),
    failedResults: new Set<string>(),
    loadFullResult: vi.fn(),
    retryFullResult: vi.fn(),
  }),
}));

vi.mock("@/composables/useReplayController", () => ({
  useReplayController: () => {
    const zero = ref(0);
    return {
      currentStep: zero,
      totalSteps: zero,
      isPlaying: ref(false),
      speed: ref(1),
      formattedElapsed: ref("0s"),
      formattedTotal: ref("0s"),
      scrubberPercent: zero,
      currentStepData: ref(null),
      play: vi.fn(),
      pause: vi.fn(),
      nextStep: vi.fn(),
      prevStep: vi.fn(),
      setSpeed: vi.fn(),
      onScrubberClick: vi.fn(),
      goToStep: vi.fn(),
    };
  },
}));

vi.mock("@/utils/replayTransform", () => ({
  turnsToReplaySteps: () => [],
}));

const stubs = {
  ReplayTransportBar: {
    template: '<div class="transport-stub" />',
    props: [
      "currentStep",
      "totalSteps",
      "isPlaying",
      "speed",
      "elapsedFormatted",
      "totalFormatted",
      "scrubberPercent",
    ],
  },
  ReplayStepContent: {
    template: '<div class="step-stub" />',
    props: [
      "step",
      "turn",
      "allTurns",
      "isCurrent",
      "isPast",
      "isFuture",
      "fullResults",
      "loadingResults",
      "failedResults",
      "isRichEnabled",
    ],
  },
  ReplaySidebar: {
    template: '<div class="sidebar-stub" />',
    props: ["step", "steps", "currentStepIndex", "totalSteps", "detail", "shutdownMetrics"],
  },
  ModelSwitchBanner: {
    template: '<div class="banner-stub" />',
    props: ["previousModel", "newModel"],
  },
  ReplayEventTicker: { template: '<div class="ticker-stub" />', props: ["steps", "currentStep"] },
  SessionCard: { template: '<div class="session-card-stub" />', props: ["session"] },
  Badge: { template: '<span class="badge-stub"><slot /></span>' },
  EmptyState: {
    template: '<div class="empty-stub"><slot /></div>',
    props: ["icon", "title", "description", "message"],
  },
  SkeletonLoader: {
    template: '<div class="skeleton-stub" />',
    props: ["lines", "variant", "count"],
  },
  ErrorAlert: {
    name: "ErrorAlert",
    props: {
      message: String,
      retryable: { type: Boolean, default: false },
    },
    emits: ["retry"],
    template:
      '<div class="error-alert-stub">{{ message }}<button v-if="retryable" class="retry-btn" @click="$emit(\'retry\')">retry</button></div>',
  },
};

const loadDetail = vi.fn();
const loadTurns = vi.fn();
const loadTodos = vi.fn();
const loadShutdownMetrics = vi.fn();

type SessionDetailStoreMock = {
  sessionId: string | null;
  detail: { id: string; repository: string; branch: string } | null;
  turns: Array<unknown>;
  shutdownMetrics: unknown;
  error: string | null;
  turnsError: string | null;
  loaded: Set<string>;
  loadDetail: typeof loadDetail;
  loadTurns: typeof loadTurns;
  loadTodos: typeof loadTodos;
  loadShutdownMetrics: typeof loadShutdownMetrics;
  loadEvents: ReturnType<typeof vi.fn>;
  loadCheckpoints: ReturnType<typeof vi.fn>;
  loadPlan: ReturnType<typeof vi.fn>;
  loadIncidents: ReturnType<typeof vi.fn>;
  loading: boolean;
  events: unknown;
  todos: unknown;
  checkpoints: Array<unknown>;
  plan: unknown;
  incidents: Array<unknown>;
  metricsError: string | null;
  todosError: string | null;
  eventsError: string | null;
  checkpointsError: string | null;
  planError: string | null;
  incidentsError: string | null;
};

let store: SessionDetailStoreMock;

vi.mock("@/stores/sessionDetail", () => ({
  useSessionDetailStore: () => store,
}));

describe("SessionReplayView", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    loadDetail.mockResolvedValue(undefined);
    loadTurns.mockImplementation(async () => {
      store.turnsError = "Failed to load turns";
    });
    loadTodos.mockResolvedValue(undefined);
    loadShutdownMetrics.mockResolvedValue(undefined);

    store = reactive<SessionDetailStoreMock>({
      sessionId: null,
      detail: { id: "session-1", repository: "acme/repo", branch: "main" },
      turns: [] as Array<unknown>,
      shutdownMetrics: null,
      error: null as string | null,
      turnsError: "Failed to load turns" as string | null,
      loaded: new Set<string>(),
      loadDetail,
      loadTurns,
      loadTodos,
      loadShutdownMetrics,
      loadEvents: vi.fn(),
      loadCheckpoints: vi.fn(),
      loadPlan: vi.fn(),
      loadIncidents: vi.fn(),
      loading: false,
      events: null,
      todos: null,
      checkpoints: [],
      plan: null,
      incidents: [],
      metricsError: null,
      todosError: null,
      eventsError: null,
      checkpointsError: null,
      planError: null,
      incidentsError: null,
      refreshAll: vi.fn(),
      prefetchSession: vi.fn(),
    });
    sessionsStore.sessions = [];
    sessionsStore.loading = false;
  });

  it("surfaces turn load errors and allows retrying the fetch", async () => {
    const wrapper = mount(SessionReplayView, { global: { stubs } });

    await flushPromises();

    expect(wrapper.find(".error-alert-stub").text()).toContain("Failed to load turns");
    expect(loadTurns).toHaveBeenCalledTimes(1);

    store.loaded.add("turns");
    await nextTick();

    await wrapper.find(".retry-btn").trigger("click");

    expect(store.loaded.has("turns")).toBe(false);
    expect(loadTurns).toHaveBeenCalledTimes(2);
  });
});
