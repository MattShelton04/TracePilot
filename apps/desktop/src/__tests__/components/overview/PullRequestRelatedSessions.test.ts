// biome-ignore-all assist/source/organizeImports: mocks must register before the component import.
import type { PullRequestSessionLink, SessionPullRequest } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";

const mocks = vi.hoisted(() => ({
  counts: vi.fn(),
  sessions: vi.fn(),
  pushRoute: vi.fn(),
  router: {},
  viewer: false,
}));

vi.mock("@tracepilot/client", async () => {
  const { createClientMock } = await import("../../mocks/client");
  return createClientMock({
    getSessionPullRequestRelatedCounts: (...args: unknown[]) => mocks.counts(...args),
    getPullRequestSessions: (...args: unknown[]) => mocks.sessions(...args),
  });
});
vi.mock("vue-router", () => ({ useRouter: () => mocks.router }));
vi.mock("@/router/navigation", () => ({ pushRoute: mocks.pushRoute }));
vi.mock("@/composables/useWindowRole", () => ({
  useWindowRole: () => ({ isViewer: () => mocks.viewer }),
}));

import PullRequestRelatedSessions from "@/components/overview/PullRequestRelatedSessions.vue";
import { ROUTE_NAMES } from "@/config/routes";
import { usePullRequestSessionsStore } from "@/stores/pullRequestSessions";
import { useSessionTabsStore } from "@/stores/sessionTabs";

const pr = makePullRequest(1046, ["created"], { primary: true });

function link(
  sessionId: string,
  extra: Partial<PullRequestSessionLink> = {},
): PullRequestSessionLink {
  return {
    sessionId,
    summary: `Session ${sessionId}`,
    repository: "example/orchard",
    source: "copilot",
    updatedAt: null,
    roles: ["updated"],
    ...extra,
  };
}

function count(otherSessionCount: number, number = pr.number) {
  return { host: pr.host, owner: pr.owner, repo: pr.repo, number, otherSessionCount };
}

async function mountWithCounts(
  rows: ReturnType<typeof count>[],
  prs: SessionPullRequest[] = [pr],
  sessionId = "s1",
) {
  mocks.counts.mockResolvedValue(rows);
  await usePullRequestSessionsStore().loadRelatedCounts(sessionId, prs);
  return mount(PullRequestRelatedSessions, {
    props: { sessionId, pr },
    attachTo: document.body,
  });
}

const trigger = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="pull-request-related"]');
const menu = () => document.querySelector('[data-testid="pull-request-related-menu"]');
const items = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="pull-request-related-session"]'),
];

describe("PullRequestRelatedSessions", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
    mocks.viewer = false;
    mocks.sessions.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders nothing while no other session shares the pull request", async () => {
    const wrapper = await mountWithCounts([count(0)]);
    expect(wrapper.html()).toBe("<!--v-if-->");
    const unknown = await mountWithCounts([count(3, 999)]);
    expect(unknown.find("button").exists()).toBe(false);
  });

  it("names how many other sessions, in the singular and plural", async () => {
    await mountWithCounts([count(1)]);
    expect(trigger()?.textContent?.trim()).toBe("Also in 1 other session");
    document.body.innerHTML = "";
    await mountWithCounts([count(3)]);
    expect(trigger()?.textContent?.trim()).toBe("Also in 3 other sessions");
  });

  it("is hidden in pop-out windows, which can't open another session", async () => {
    mocks.viewer = true;
    await mountWithCounts([count(2)]);
    expect(trigger()).toBeNull();
  });

  it("loads the sessions only when opened, once, without this session", async () => {
    mocks.sessions.mockResolvedValue([
      link("s1"),
      link("s2", { summary: "Worker one", roles: ["created", "merged"] }),
      link("s3", { summary: null, source: "claudeCode" }),
    ]);
    await mountWithCounts([count(2)]);
    expect(mocks.sessions).not.toHaveBeenCalled();

    trigger()?.click();
    await flushPromises();
    expect(mocks.sessions).toHaveBeenCalledWith({
      host: pr.host,
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    });
    expect(menu()?.getAttribute("role")).toBe("menu");
    expect(
      items().map((item) => item.querySelector(".pr-related-menu__title")?.textContent),
    ).toEqual(["Worker one", "s3"]);
    expect(items()[0].textContent).toContain("Copilot · Created · Merged");
    expect(items()[1].textContent).toContain("Claude Code · Updated");

    // Closing and opening again uses the cached list.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(menu()).toBeNull();
    trigger()?.click();
    await flushPromises();
    expect(mocks.sessions).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(2);
  });

  it("opens a session on click, and in a tab on Ctrl+click", async () => {
    mocks.sessions.mockResolvedValue([link("s2", { summary: "Worker one" })]);
    await mountWithCounts([count(1)]);
    trigger()?.click();
    await flushPromises();

    items()[0].click();
    await flushPromises();
    expect(mocks.pushRoute).toHaveBeenCalledWith(mocks.router, ROUTE_NAMES.sessionOverview, {
      params: { id: "s2" },
    });
    expect(menu()).toBeNull();

    trigger()?.click();
    await flushPromises();
    items()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await flushPromises();
    expect(mocks.pushRoute).toHaveBeenCalledTimes(1);
    expect(useSessionTabsStore().tabs.map((tab) => tab.sessionId)).toContain("s2");
  });

  it("says when only this session is left", async () => {
    mocks.sessions.mockResolvedValue([link("s1")]);
    await mountWithCounts([count(1)]);
    trigger()?.click();
    await flushPromises();
    expect(menu()?.textContent).toContain("No other sessions found.");
  });

  it("shows an error with a retry that loads again", async () => {
    mocks.sessions.mockRejectedValueOnce(new Error("index locked"));
    await mountWithCounts([count(1)]);
    trigger()?.click();
    await flushPromises();
    expect(menu()?.textContent).toContain("Couldn't load the sessions.");

    mocks.sessions.mockResolvedValueOnce([link("s2")]);
    document
      .querySelector<HTMLButtonElement>('[data-testid="pull-request-related-retry"]')
      ?.click();
    await flushPromises();
    expect(mocks.sessions).toHaveBeenCalledTimes(2);
    expect(items()).toHaveLength(1);
  });
});

describe("pullRequestSessions store", () => {
  beforeEach(() => {
    setupPinia();
    vi.clearAllMocks();
  });

  it("counts once per pull-request list, and not at all for none", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValue([count(2)]);
    await store.loadRelatedCounts("s1", []);
    expect(mocks.counts).not.toHaveBeenCalled();

    const prs = [pr];
    await store.loadRelatedCounts("s1", prs);
    await store.loadRelatedCounts("s1", prs);
    expect(mocks.counts).toHaveBeenCalledTimes(1);
    expect(store.relatedCount("s1", { ...pr, owner: "EXAMPLE" })).toBe(2);

    // A refreshed list counts again and drops the cached menus.
    mocks.sessions.mockResolvedValue([link("s2")]);
    await store.loadRelatedSessions("s1", pr);
    expect(store.relatedSessions("s1", pr)?.status).toBe("ready");
    await store.loadRelatedCounts("s1", [pr]);
    expect(mocks.counts).toHaveBeenCalledTimes(2);
    expect(store.relatedSessions("s1", pr)).toBeNull();
  });

  it("drops counts that land after the session's list was replaced", async () => {
    const store = usePullRequestSessionsStore();
    let resolveOld!: (rows: unknown) => void;
    mocks.counts.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)));
    mocks.counts.mockResolvedValueOnce([count(1)]);

    const first = store.loadRelatedCounts("s1", [pr]);
    await store.loadRelatedCounts("s1", [pr]);
    resolveOld([count(9)]);
    await first;
    expect(store.relatedCount("s1", pr)).toBe(1);
  });

  it("drops a session list that lands after the counts reloaded", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValue([count(1)]);
    await store.loadRelatedCounts("s1", [pr]);
    let resolveOld!: (links: unknown) => void;
    mocks.sessions.mockImplementationOnce(() => new Promise((resolve) => (resolveOld = resolve)));
    const pending = store.loadRelatedSessions("s1", pr);

    await store.loadRelatedCounts("s1", [pr]);
    resolveOld([link("s2")]);
    await pending;
    expect(store.relatedSessions("s1", pr)).toBeNull();
  });

  it("keeps each open session's counts apart", async () => {
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValueOnce([count(1)]).mockResolvedValueOnce([count(4)]);
    await store.loadRelatedCounts("s1", [pr]);
    await store.loadRelatedCounts("s2", [pr]);
    expect(store.relatedCount("s1", pr)).toBe(1);
    expect(store.relatedCount("s2", pr)).toBe(4);
    expect(mocks.counts.mock.calls).toEqual([["s1"], ["s2"]]);
  });
});
