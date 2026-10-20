// biome-ignore-all assist/source/organizeImports: mocks must register before the component import.
import type { ConversationTurn, SessionPullRequest } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { EXTERNAL_LINK_HANDLER_KEY } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";
import { NAVIGATE_CONVERSATION_KEY } from "@/composables/useConversationNavigation";
import { usePullRequestSessionsStore } from "@/stores/pullRequestSessions";
import { OVERVIEW_MODEL_KEY } from "../overview/overviewModel";
import PullRequestsSection from "../overview/PullRequestsSection.vue";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  relatedCounts: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    getSessionPullRequestRelatedCounts: (...args: unknown[]) => mocks.relatedCounts(...args),
  });
});
vi.mock("vue-router", () => ({ useRouter: () => ({}) }));

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  const { ref } = await import("vue");
  return {
    ...module,
    useClipboard: () => ({ copy: mocks.copy, copied: ref(false) }),
    useToast: () => ({ success: mocks.success, error: vi.fn(), warning: mocks.warning }),
  };
});

const store = reactive({
  sessionId: "s1",
  pullRequests: [] as SessionPullRequest[],
  turns: [] as ConversationTurn[],
  loadTurns: vi.fn(async () => {}),
});

function mountSection(open: ((url: string) => void) | null = vi.fn(), navigate = vi.fn()) {
  return mount(PullRequestsSection, {
    global: {
      provide: {
        [OVERVIEW_MODEL_KEY as symbol]: { store },
        [NAVIGATE_CONVERSATION_KEY as symbol]: navigate,
        ...(open ? { [EXTERNAL_LINK_HANDLER_KEY as symbol]: open } : {}),
      },
    },
  });
}

const rowNumbers = (wrapper: ReturnType<typeof mountSection>) =>
  wrapper.findAll('[data-testid="pull-request-row"]').map((row) => row.get(".pr-row__mono").text());

describe("PullRequestsSection", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.relatedCounts.mockResolvedValue([]);
    mocks.copy.mockResolvedValue(true);
    store.pullRequests = [];
    store.turns = [];
  });

  it("is hidden when the session links none", () => {
    expect(mountSection().find('[data-testid="pull-requests-section"]').exists()).toBe(false);
  });

  it("shows reviewed pull requests as rows under their own label", () => {
    store.pullRequests = [
      makePullRequest(1046, ["created"], {
        primary: true,
        title: "Retry index writes",
        headRef: "fix/retry",
        baseRef: "main",
      }),
      makePullRequest(1012, ["reviewed"]),
    ];
    const wrapper = mountSection();
    expect(wrapper.text()).toContain("2 linked");
    expect(rowNumbers(wrapper)).toEqual(["example/orchard#1046", "example/orchard#1012"]);
    expect(wrapper.findAll(".pr-group__label").map((l) => l.text())).toEqual([
      "Created or updated",
      "Reviewed",
    ]);
    const [first, second] = wrapper.findAll('[data-testid="pull-request-row"]');
    expect(first.get(".pr-row__title").text()).toBe("Retry index writes");
    expect(first.text()).toContain("fix/retry → main");
    expect(first.text()).toContain("Created");
    // No title recorded: named by its number. No state until GitHub is asked.
    expect(second.get(".pr-row__title").text()).toBe("Pull request #1012");
    expect(second.findComponent({ name: "StatusPill" }).exists()).toBe(false);
  });

  it("labels nothing when every pull request is in one group", () => {
    store.pullRequests = [makePullRequest(1, ["reviewed"], { primary: true })];
    expect(mountSection().find(".pr-group__label").exists()).toBe(false);
  });

  it("collapses a group of more than five behind a summary", async () => {
    store.pullRequests = [
      makePullRequest(1, ["created"], { primary: true }),
      ...[2, 3, 4, 5, 6, 7].map((n) => makePullRequest(n, ["merged"])),
    ];
    const wrapper = mountSection();
    expect(rowNumbers(wrapper)).toEqual(["example/orchard#1"]);
    const toggle = wrapper.get(".pr-group__toggle");
    expect(toggle.text()).toBe("Merged 6 pull requests");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    await toggle.trigger("click");
    expect(rowNumbers(wrapper)).toHaveLength(7);
  });

  it("opens, copies and jumps to where the pull request was linked", async () => {
    const pr = makePullRequest(1046, ["created"], { primary: true, eventIndex: 5 });
    store.pullRequests = [pr, makePullRequest(1012, ["reviewed"])];
    store.turns = [
      { turnIndex: 0, eventIndex: 1, toolCalls: [{ eventIndex: 5 }] },
    ] as unknown as ConversationTurn[];
    const open = vi.fn();
    const navigate = vi.fn();
    const wrapper = mountSection(open, navigate);
    const [row, other] = wrapper.findAll('[data-testid="pull-request-row"]');

    await row.get('[data-testid="pull-request-open"]').trigger("click");
    expect(open).toHaveBeenCalledWith(pr.url);

    await row.get('[data-testid="pull-request-copy"]').trigger("click");
    await flushPromises();
    expect(mocks.copy).toHaveBeenCalledWith(pr.url);
    expect(mocks.success).toHaveBeenCalledWith("Link copied", undefined);

    await row.get('[data-testid="pull-request-jump"]').trigger("click");
    await flushPromises();
    expect(store.loadTurns).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ turnIndex: 0, eventIndex: 5 });

    // Without a recorded event there is nowhere to jump to.
    expect(other.find('[data-testid="pull-request-jump"]').exists()).toBe(false);
  });

  it("warns when the event is not in the conversation", async () => {
    store.pullRequests = [makePullRequest(1, ["created"], { primary: true, eventIndex: 99 })];
    const navigate = vi.fn();
    const wrapper = mountSection(vi.fn(), navigate);
    await wrapper.get('[data-testid="pull-request-jump"]').trigger("click");
    await flushPromises();
    expect(navigate).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalled();
  });

  it("counts other sessions once per loaded list and offers them on the row", async () => {
    const pr = makePullRequest(1046, ["created"], { primary: true });
    mocks.relatedCounts.mockResolvedValue([
      { host: pr.host, owner: pr.owner, repo: pr.repo, number: pr.number, otherSessionCount: 2 },
    ]);
    store.pullRequests = [pr, makePullRequest(1012, ["reviewed"])];
    const wrapper = mountSection();
    await flushPromises();
    expect(mocks.relatedCounts).toHaveBeenCalledWith("s1");
    const [row, other] = wrapper.findAll('[data-testid="pull-request-row"]');
    expect(row.get('[data-testid="pull-request-related"]').text()).toBe("Also in 2 other sessions");
    expect(other.find('[data-testid="pull-request-related"]').exists()).toBe(false);

    // A refresh naming the same pull requests doesn't count again; another set does.
    mountSection();
    store.pullRequests = store.pullRequests.map((p) => ({ ...p }));
    await flushPromises();
    expect(mocks.relatedCounts).toHaveBeenCalledTimes(1);
    store.pullRequests = [...store.pullRequests, makePullRequest(7, ["merged"])];
    await flushPromises();
    expect(mocks.relatedCounts).toHaveBeenCalledTimes(2);
    expect(row.find('[data-testid="pull-request-related"]').exists()).toBe(true);
  });

  it("counts again when the store let the session's counts go", async () => {
    store.pullRequests = [makePullRequest(1046, ["created"], { primary: true })];
    mountSection();
    await flushPromises();
    expect(mocks.relatedCounts).toHaveBeenCalledTimes(1);
    // Other sessions opened since; this one, still on screen, was evicted.
    const related = usePullRequestSessionsStore();
    for (let i = 0; i < 32; i++) await related.loadRelatedCounts(`other-${i}`, store.pullRequests);
    await flushPromises();
    expect(mocks.relatedCounts).toHaveBeenCalledWith("s1");
    expect(mocks.relatedCounts.mock.calls.filter(([id]) => id === "s1")).toHaveLength(2);
    expect(related.hasEntry("s1")).toBe(true);
  });

  it("offers only Copy link in a pop-out window", () => {
    store.pullRequests = [makePullRequest(1, ["created"], { primary: true })];
    const wrapper = mountSection(null);
    expect(wrapper.find('[data-testid="pull-request-open"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pull-request-copy"]').exists()).toBe(true);
  });
});
