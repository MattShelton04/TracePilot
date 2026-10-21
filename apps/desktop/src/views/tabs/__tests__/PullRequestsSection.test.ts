// biome-ignore-all assist/source/organizeImports: mocks must register before the component import.
import { refreshSessionPullRequests } from "@tracepilot/client";
import { createDeferred, setupPinia } from "@tracepilot/test-utils";
import type {
  ConversationTurn,
  PullRequestRefreshResult,
  SessionPullRequest,
} from "@tracepilot/types";
import { EXTERNAL_LINK_HANDLER_KEY } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";
import { NAVIGATE_CONVERSATION_KEY } from "@/composables/useConversationNavigation";
import { useWindowRole } from "@/composables/useWindowRole";
import { STORAGE_KEYS } from "@/config/storageKeys";
import { usePreferencesStore } from "@/stores/preferences";
import { usePullRequestSessionsStore } from "@/stores/pullRequestSessions";
import { usePullRequestStatusStore } from "@/stores/pullRequestStatus";
import { OVERVIEW_MODEL_KEY } from "../overview/overviewModel";
import PullRequestsSection from "../overview/PullRequestsSection.vue";

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  push: vi.fn(),
  relatedCounts: vi.fn(),
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("@/__tests__/mocks/client");
  return createClientMock({
    getSessionPullRequestRelatedCounts: (...args: unknown[]) => mocks.relatedCounts(...args),
  });
});

vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.push }) }));

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
  reloadPullRequests: vi.fn(async () => {}),
});

function result(fields: Partial<PullRequestRefreshResult> = {}): PullRequestRefreshResult {
  return { lookup: "ok", updated: [], linksChanged: false, ...fields };
}

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
    localStorage.clear();
    vi.clearAllMocks();
    mocks.relatedCounts.mockResolvedValue([]);
    mocks.copy.mockResolvedValue(true);
    vi.mocked(refreshSessionPullRequests).mockResolvedValue(result());
    store.sessionId = "s1";
    store.pullRequests = [];
    store.turns = [];
  });
  afterEach(() => {
    useWindowRole().role.value = "main";
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

  describe("status from GitHub", () => {
    const refreshButton = (wrapper: ReturnType<typeof mountSection>) =>
      wrapper.find('[data-testid="pull-requests-refresh"]');
    const note = (wrapper: ReturnType<typeof mountSection>) =>
      wrapper.find('[data-testid="pull-request-lookup-note"]');

    beforeEach(() => {
      store.pullRequests = [makePullRequest(1, ["created"], { primary: true })];
    });

    afterEach(() => {
      usePreferencesStore().pullRequestLookup = true;
    });

    it("refreshes every pull request on demand, spinning until GitHub answers", async () => {
      const pending = createDeferred<PullRequestRefreshResult>();
      vi.mocked(refreshSessionPullRequests).mockReturnValueOnce(pending.promise);
      const wrapper = mountSection();
      const button = refreshButton(wrapper);
      expect(button.text()).toBe("Refresh");

      await button.trigger("click");
      expect(refreshSessionPullRequests).toHaveBeenCalledWith("s1", true);
      expect(button.attributes("aria-disabled")).toBe("true");
      expect(button.attributes("aria-busy")).toBe("true");
      expect(button.get(".pr-refresh__icon").classes()).toContain("pr-refresh__icon--spinning");
      // Rows stay as they are while it runs.
      expect(wrapper.findAll('[data-testid="pull-request-row"]')).toHaveLength(1);

      // A second click while it runs asks nothing more.
      await button.trigger("click");
      expect(refreshSessionPullRequests).toHaveBeenCalledTimes(1);

      const { host, owner, repo, number, url } = store.pullRequests[0];
      pending.resolve(result({ updated: [{ host, owner, repo, number, url, state: "open" }] }));
      await flushPromises();
      expect(store.reloadPullRequests).toHaveBeenCalledTimes(1);
      expect(button.attributes("aria-disabled")).toBe("false");
      expect(button.get(".pr-refresh__icon").classes()).not.toContain("pr-refresh__icon--spinning");
    });

    it("runs a click made during an automatic lookup once that one ends", async () => {
      const passive = createDeferred<PullRequestRefreshResult>();
      vi.mocked(refreshSessionPullRequests).mockReturnValueOnce(passive.promise);
      const wrapper = mountSection();
      const automatic = usePullRequestStatusStore().refreshSession("s1");
      await flushPromises();
      const button = refreshButton(wrapper);
      expect(button.attributes("aria-busy")).toBe("true");
      expect(button.attributes("aria-disabled")).toBe("false");

      await button.trigger("click");
      expect(button.attributes("aria-disabled")).toBe("true");
      passive.resolve(result());
      await automatic;
      await flushPromises();
      expect(refreshSessionPullRequests).toHaveBeenCalledTimes(2);
      expect(refreshSessionPullRequests).toHaveBeenLastCalledWith("s1", true);
      expect(button.attributes("aria-disabled")).toBe("false");
    });

    it.each([
      ["answers failed", () => Promise.resolve(result({ lookup: "failed" }))],
      ["throws", () => Promise.reject(new Error("gh timed out"))],
    ] as const)("says so when a Refresh click %s", async (_, answer) => {
      vi.mocked(refreshSessionPullRequests).mockImplementationOnce(answer);
      const wrapper = mountSection();
      await refreshButton(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.warning).toHaveBeenCalledWith("Couldn't look up these pull requests on GitHub");
    });

    it("stays quiet when an automatic lookup fails or a click succeeds", async () => {
      const wrapper = mountSection();
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup: "failed" }));
      await usePullRequestStatusStore().refreshSession("s1");
      vi.mocked(refreshSessionPullRequests).mockRejectedValueOnce(new Error("offline"));
      await usePullRequestStatusStore().refreshSession("s1");
      await refreshButton(wrapper).trigger("click");
      await flushPromises();
      expect(mocks.warning).not.toHaveBeenCalled();
    });

    it("keeps keyboard focus on Refresh while it runs", async () => {
      const pending = createDeferred<PullRequestRefreshResult>();
      vi.mocked(refreshSessionPullRequests).mockReturnValueOnce(pending.promise);
      const wrapper = mount(PullRequestsSection, {
        attachTo: document.body,
        global: {
          provide: {
            [OVERVIEW_MODEL_KEY as symbol]: { store },
            [NAVIGATE_CONVERSATION_KEY as symbol]: vi.fn(),
          },
        },
      });
      const button = refreshButton(wrapper);
      (button.element as HTMLButtonElement).focus();
      await button.trigger("click");
      expect(button.attributes("disabled")).toBeUndefined();
      expect(document.activeElement).toBe(button.element);
      pending.resolve(result());
      await flushPromises();
      expect(document.activeElement).toBe(button.element);
      wrapper.unmount();
    });

    it("doesn't reload when the lookup changed nothing", async () => {
      const wrapper = mountSection();
      await refreshButton(wrapper).trigger("click");
      await flushPromises();
      expect(store.reloadPullRequests).not.toHaveBeenCalled();
    });

    it("hides Refresh in a pop-out and while the setting is off", () => {
      useWindowRole().role.value = "viewer";
      expect(refreshButton(mountSection(null)).exists()).toBe(false);
      useWindowRole().role.value = "main";
      usePreferencesStore().pullRequestLookup = false;
      expect(refreshButton(mountSection()).exists()).toBe(false);
    });

    it.each([
      ["notInstalled", "Install and sign in to the GitHub CLI to see pull request status."],
      ["signedOut", "Sign in to the GitHub CLI to see pull request status."],
    ] as const)("explains a %s lookup, with a way to Settings", async (lookup, text) => {
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup }));
      await usePullRequestStatusStore().refreshSession("s1");
      const wrapper = mountSection();
      expect(note(wrapper).text()).toContain(text);
      await note(wrapper).get(".pr-note__link").trigger("click");
      expect(mocks.push).toHaveBeenCalledWith({ name: "settings" });
    });

    it("says when lookups are off", () => {
      usePreferencesStore().pullRequestLookup = false;
      expect(note(mountSection()).text()).toContain("Pull request status lookups are off.");
    });

    it.each([
      "ok",
      "failed",
    ] as const)("says nothing after a lookup that was %s", async (lookup) => {
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup }));
      await usePullRequestStatusStore().refreshSession("s1");
      expect(note(mountSection()).exists()).toBe(false);
    });

    it("remembers a dismissed note, per reason", async () => {
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup: "signedOut" }));
      await usePullRequestStatusStore().refreshSession("s1");
      const wrapper = mountSection();
      await wrapper.get('[data-testid="pull-request-lookup-note-dismiss"]').trigger("click");
      expect(note(wrapper).exists()).toBe(false);
      const saved = () =>
        JSON.parse(localStorage.getItem(STORAGE_KEYS.pullRequestNoticeDismissed) ?? "null");
      expect(saved()).toEqual(["cli"]);
      expect(note(mountSection()).exists()).toBe(false);

      // Turning lookups off is a different reason, so that note shows.
      usePreferencesStore().pullRequestLookup = false;
      const off = mountSection();
      expect(note(off).exists()).toBe(true);
      await off.get('[data-testid="pull-request-lookup-note-dismiss"]').trigger("click");
      expect(saved()).toEqual(["cli", "disabled"]);

      // Both stay dismissed: dismissing one doesn't bring back the other.
      expect(note(mountSection()).exists()).toBe(false);
      usePreferencesStore().pullRequestLookup = true;
      await flushPromises();
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(
        result({ lookup: "notInstalled" }),
      );
      await usePullRequestStatusStore().refreshSession("s1");
      expect(note(mountSection()).exists()).toBe(false);
    });

    it("reads a malformed saved dismissal as none", async () => {
      localStorage.setItem(STORAGE_KEYS.pullRequestNoticeDismissed, '"cli"');
      vi.mocked(refreshSessionPullRequests).mockResolvedValueOnce(result({ lookup: "signedOut" }));
      await usePullRequestStatusStore().refreshSession("s1");
      expect(note(mountSection()).exists()).toBe(true);
    });

    it("shows no note in a pop-out", () => {
      usePreferencesStore().pullRequestLookup = false;
      useWindowRole().role.value = "viewer";
      expect(note(mountSection(null)).exists()).toBe(false);
    });
  });
});
