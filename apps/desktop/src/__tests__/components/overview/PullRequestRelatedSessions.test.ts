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
    summary: `Summary ${sessionId}`,
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
const panel = () =>
  document.querySelector<HTMLElement>('[data-testid="pull-request-related-menu"]');
const menu = () => panel()?.querySelector('[role="menu"]') ?? null;
const items = () => [
  ...document.querySelectorAll<HTMLButtonElement>('[data-testid="pull-request-related-session"]'),
];
const titles = () =>
  items().map((item) => item.querySelector(".pr-related-menu__title")?.textContent);

async function openMenu() {
  trigger()?.click();
  await flushPromises();
}

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
    const unknown = await mountWithCounts([count(3, 999)], [pr], "s2");
    expect(unknown.find("button").exists()).toBe(false);
  });

  it("names how many other sessions, in the singular and plural", async () => {
    await mountWithCounts([count(1)]);
    expect(trigger()?.textContent?.trim()).toBe("Also in 1 other session");
    document.body.innerHTML = "";
    await mountWithCounts([count(3)], [pr], "s2");
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
      link("s3abcdef99", { summary: null, source: "claudeCode" }),
    ]);
    await mountWithCounts([count(2)]);
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(trigger()?.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger()?.hasAttribute("aria-controls")).toBe(false);

    await openMenu();
    expect(mocks.sessions).toHaveBeenCalledWith({
      host: pr.host,
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
    });
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger()?.getAttribute("aria-controls")).toBe(menu()?.id);
    expect(titles()).toEqual(["Worker one", "Session s3abcdef"]);
    expect(items()[0].textContent).toContain("Copilot · Created · Merged");
    expect(items()[1].textContent).toContain("Claude Code · Updated");
    // The menu holds only its items; the list loaded with focus on the first.
    expect(menu()?.querySelectorAll(":scope > :not([role='menuitem'])")).toHaveLength(0);
    expect(document.activeElement).toBe(items()[0]);

    // Closing and opening again uses the cached list.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(panel()).toBeNull();
    await openMenu();
    expect(mocks.sessions).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(2);
  });

  it("describes the loading state outside the menu's items", async () => {
    mocks.sessions.mockImplementation(() => new Promise(() => {}));
    await mountWithCounts([count(1)]);
    await openMenu();
    const status = panel()?.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe("Loading sessions…");
    expect(menu()?.getAttribute("aria-busy")).toBe("true");
    expect(menu()?.getAttribute("aria-describedby")).toBe(status?.id);
    expect(menu()?.contains(status ?? null)).toBe(false);
  });

  it("opens a session on click, and in a tab on Ctrl+click", async () => {
    mocks.sessions.mockResolvedValue([link("s2", { summary: "Worker one" })]);
    await mountWithCounts([count(1)]);
    await openMenu();

    items()[0].click();
    await flushPromises();
    expect(mocks.pushRoute).toHaveBeenCalledWith(mocks.router, ROUTE_NAMES.sessionOverview, {
      params: { id: "s2" },
    });
    expect(panel()).toBeNull();

    await openMenu();
    items()[0].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    await flushPromises();
    expect(mocks.pushRoute).toHaveBeenCalledTimes(1);
    expect(useSessionTabsStore().tabs.map((tab) => tab.sessionId)).toContain("s2");
  });

  it("says when only this session is left", async () => {
    mocks.sessions.mockResolvedValue([link("s1")]);
    await mountWithCounts([count(1)]);
    await openMenu();
    expect(panel()?.textContent).toContain("No other sessions found.");
    expect(panel()?.querySelector('[data-testid="pull-request-related-more"]')).toBeNull();
  });

  it("notes the sessions past the list's limit", async () => {
    mocks.sessions.mockResolvedValue([link("s1"), link("s2"), link("s3")]);
    await mountWithCounts([count(130)]);
    await openMenu();
    expect(items()).toHaveLength(2);
    const more = panel()?.querySelector('[data-testid="pull-request-related-more"]');
    expect(more?.textContent?.trim()).toBe("and 128 more");
    expect(menu()?.contains(more ?? null)).toBe(false);
  });

  it("shows an error with a retry that loads again and keeps focus in the menu", async () => {
    mocks.sessions.mockRejectedValueOnce(new Error("index locked"));
    await mountWithCounts([count(1)]);
    await openMenu();
    expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain(
      "Couldn't load the sessions.",
    );
    const retry = document.querySelector<HTMLButtonElement>(
      '[data-testid="pull-request-related-retry"]',
    );
    expect(document.activeElement).toBe(retry);

    let resolve!: (links: PullRequestSessionLink[]) => void;
    mocks.sessions.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    retry?.click();
    await flushPromises();
    expect(document.activeElement).toBe(panel());
    resolve([link("s2")]);
    await flushPromises();
    expect(mocks.sessions).toHaveBeenCalledTimes(2);
    expect(items()).toHaveLength(1);
    expect(document.activeElement).toBe(items()[0]);
  });

  it("stays open with its list when a refresh lists the same pull requests", async () => {
    mocks.sessions.mockResolvedValue([link("s2")]);
    await mountWithCounts([count(1)]);
    await openMenu();
    expect(items()).toHaveLength(1);

    // A running session's poll: a new array naming the same pull requests.
    await usePullRequestSessionsStore().loadRelatedCounts("s1", [{ ...pr }]);
    await flushPromises();
    expect(mocks.counts).toHaveBeenCalledTimes(1);
    expect(panel()).not.toBeNull();
    expect(items()).toHaveLength(1);
    expect(mocks.sessions).toHaveBeenCalledTimes(1);
  });

  it("keeps the button while changed pull requests are counted again", async () => {
    await mountWithCounts([count(2)]);
    let resolve!: (rows: unknown) => void;
    mocks.counts.mockImplementationOnce(() => new Promise((r) => (resolve = r)));

    const loading = usePullRequestSessionsStore().loadRelatedCounts("s1", [
      pr,
      makePullRequest(7, ["reviewed"]),
    ]);
    await flushPromises();
    expect(mocks.counts).toHaveBeenCalledTimes(2);
    expect(trigger()?.textContent?.trim()).toBe("Also in 2 other sessions");

    resolve([count(3), count(1, 7)]);
    await loading;
    await flushPromises();
    expect(trigger()?.textContent?.trim()).toBe("Also in 3 other sessions");
  });

  it("closes when no count is left, and loads a dropped list again on the next open", async () => {
    mocks.sessions.mockResolvedValue([link("s2")]);
    await mountWithCounts([count(1)]);
    await openMenu();
    // The counts reload for a set without this pull request, then with it again.
    const store = usePullRequestSessionsStore();
    mocks.counts.mockResolvedValueOnce([]);
    await store.loadRelatedCounts("s1", [makePullRequest(7, ["reviewed"])]);
    await flushPromises();
    expect(panel()).toBeNull();
    mocks.counts.mockResolvedValueOnce([count(1)]);
    await store.loadRelatedCounts("s1", [pr]);
    await openMenu();
    expect(mocks.sessions).toHaveBeenCalledTimes(2);
    expect(items()).toHaveLength(1);
  });
});
