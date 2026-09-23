import type { SessionWorkRefsResponse, StoredWorkRef } from "@tracepilot/types";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RelatedWorkPanel from "@/components/session/RelatedWorkPanel.vue";

const getSessionWorkRefs = vi.fn<(sessionId: string) => Promise<SessionWorkRefsResponse>>();
const openExternal = vi.fn();
let enrichmentEnabled = true;

vi.mock("@tracepilot/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tracepilot/client")>()),
  getSessionWorkRefs: (sessionId: string) => getSessionWorkRefs(sessionId),
}));

const events = vi.hoisted(() => ({ finished: () => {} }));
vi.mock("@/lib/tauri", () => ({
  tauriListen: vi.fn(async (_event: string, handler: () => void) => {
    events.finished = handler;
    return () => {};
  }),
}));

vi.mock("@/stores/preferences", () => ({
  usePreferencesStore: () => ({
    isFeatureEnabled: (flag: string) => flag === "sessionStoreEnrichment" && enrichmentEnabled,
  }),
}));

const pushRoute = vi.hoisted(() => vi.fn());
vi.mock("@/router/navigation", () => ({ pushRoute }));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({}),
}));

// Only the side-effecting half is replaced: `parseExternalUrl` is the real
// validation the component relies on to decide what may become a link.
vi.mock("@/utils/openExternal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/openExternal")>();
  return { ...actual, openExternal: (url: string) => openExternal(url) };
});

function ref(overrides: Partial<StoredWorkRef> = {}): StoredWorkRef {
  return {
    identity: overrides.identity ?? "id",
    sessionId: "session-a",
    sourceRowId: 1,
    kind: "pullRequest",
    rawValue: "#1",
    normalizedValue: "1",
    resolvedHost: null,
    resolvedRepository: null,
    candidateRepository: null,
    resolution: "unresolved",
    shaShaped: false,
    sourceTurnIndex: 3,
    recordedAt: null,
    ...overrides,
  } as StoredWorkRef;
}

function respond(response: Partial<SessionWorkRefsResponse>) {
  getSessionWorkRefs.mockResolvedValue({
    enabled: true,
    available: true,
    refs: [],
    sourceAvailability: "ready",
    ...response,
  });
}

async function mountPanel(hostType: string | null = null) {
  const wrapper = mount(RelatedWorkPanel, {
    props: { sessionId: "session-a", hostType },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** A bare PR number the store placed in the session's repository. */
function contextPr(value: string, overrides: Partial<StoredWorkRef> = {}): StoredWorkRef {
  return ref({
    identity: value,
    rawValue: `#${value}`,
    normalizedValue: value,
    candidateRepository: "owner/project",
    resolvedRepository: "owner/project",
    resolution: "sessionContext",
    ...overrides,
  });
}

const writeText = vi.fn(async (_text: string) => {});

beforeEach(() => {
  enrichmentEnabled = true;
  getSessionWorkRefs.mockReset();
  openExternal.mockReset();
  pushRoute.mockReset();
  writeText.mockClear();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  document.body.innerHTML = "";
  respond({});
});

it("reloads visible references when enrichment finishes", async () => {
  respond({ refs: [] });
  const wrapper = await mountPanel();
  respond({ refs: [ref({ rawValue: "#321", normalizedValue: "321" })] });
  events.finished();
  await flushPromises();
  expect(getSessionWorkRefs).toHaveBeenCalledTimes(2);
  expect(wrapper.text()).toContain("321");
  wrapper.unmount();
});

it("keeps a long group compact and expands it in place", async () => {
  respond({
    refs: Array.from({ length: 45 }, (_, index) =>
      ref({ identity: String(index), normalizedValue: String(index + 1) }),
    ),
  });
  const wrapper = await mountPanel();
  expect(wrapper.findAll(".related-work-row")).toHaveLength(40);
  const more = wrapper.get("button.ref-more");
  expect(more.text()).toBe("+5 more");
  await more.trigger("click");
  expect(wrapper.findAll(".related-work-row")).toHaveLength(45);
  expect(wrapper.get("button.ref-more").attributes("aria-expanded")).toBe("true");
  wrapper.unmount();
});

it("groups by kind in numeric order and states a shared repository once", async () => {
  respond({
    refs: [
      ref({ identity: "g", kind: "gitRef", rawValue: "main", normalizedValue: "main" }),
      ref({
        identity: "s",
        kind: "gitRef",
        rawValue: "c598b556",
        normalizedValue: "c598b556",
        shaShaped: true,
      }),
      ...["110", "9", "25"].map((value) => contextPr(value)),
    ],
  });
  const wrapper = await mountPanel();

  const groups = wrapper.findAll(".related-work-group");
  expect(groups.map((group) => group.attributes("data-kind"))).toEqual([
    "pullRequest",
    "commit",
    "branch",
  ]);
  expect(groups.map((group) => group.get(".ref-kind").text())).toEqual([
    "Pull requests 3",
    "Commits 1",
    "Branches and other refs 1",
  ]);
  const prs = wrapper.findAll('[data-kind="pullRequest"] .related-work-row');
  expect(prs.map((chip) => chip.text())).toEqual(["#9", "#25", "#110"]);
  // The assumed repository is one sentence, not a warning on every chip.
  expect(wrapper.findAll(".ref-repo-inferred")).toHaveLength(1);
  expect(wrapper.find(".related-work-row .ref-repo").exists()).toBe(false);
  wrapper.unmount();
});

it("ignores a previous session response that arrives after navigation", async () => {
  let finishOld: ((value: SessionWorkRefsResponse) => void) | undefined;
  getSessionWorkRefs.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const wrapper = mount(RelatedWorkPanel, { props: { sessionId: "session-a" } });
  await flushPromises();
  respond({ refs: [ref({ rawValue: "#222", normalizedValue: "222" })] });
  await wrapper.setProps({ sessionId: "session-b" });
  await flushPromises();
  finishOld?.({
    enabled: true,
    available: true,
    refs: [ref({ rawValue: "#111", normalizedValue: "111" })],
    sourceAvailability: "ready",
  });
  await flushPromises();
  expect(wrapper.text()).toContain("222");
  expect(wrapper.text()).not.toContain("111");
  wrapper.unmount();
});

describe("RelatedWorkPanel", () => {
  it("renders nothing while the enrichment feature is off", async () => {
    enrichmentEnabled = false;
    const wrapper = await mountPanel();

    expect(wrapper.text()).toBe("");
    expect(getSessionWorkRefs).not.toHaveBeenCalled();
  });

  it("says the references found are not proof the work was done, once", async () => {
    respond({
      refs: [
        ref({ identity: "a", resolution: "unresolved" }),
        ref({ identity: "b", resolution: "unresolved" }),
      ],
    });
    const wrapper = await mountPanel();

    const notes = wrapper.findAll(".related-work-note");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text()).toMatch(/not proof/i);
    expect(wrapper.findAll(".related-work-row")).toHaveLength(2);
  });

  it("opens an explicit reference on the host it named", async () => {
    respond({
      refs: [
        ref({
          identity: "pr",
          kind: "pullRequest",
          rawValue: "https://github.example.com/owner/project/pull/844",
          normalizedValue: "844",
          resolvedHost: "github.example.com",
          resolvedRepository: "owner/project",
          candidateRepository: "owner/project",
          resolution: "explicit",
        }),
      ],
    });
    const wrapper = await mountPanel("github");

    const chip = wrapper.get('[data-resolution="explicit"] .ref-chip');
    expect(chip.text()).toContain("owner/project");
    expect(chip.text()).toContain("#844");
    expect(chip.attributes("title")).toMatch(/named the host and repository/);
    await chip.trigger("click");
    expect(openExternal).toHaveBeenCalledWith("https://github.example.com/owner/project/pull/844");
    wrapper.unmount();
  });

  it("links a bare number into the session's repository on github.com", async () => {
    respond({ refs: [contextPr("512", { kind: "issue" })] });
    const wrapper = await mountPanel("github");

    const chip = wrapper.get(".ref-chip");
    expect(chip.classes()).toContain("ref-chip--link");
    expect(chip.attributes("title")).toContain("owner/project (from this session)");
    await chip.trigger("click");
    expect(openExternal).toHaveBeenCalledWith("https://github.com/owner/project/issues/512");
    wrapper.unmount();
  });

  it("never assumes a host for a bare number when the session's host is unknown", async () => {
    respond({ refs: [contextPr("512")] });
    const wrapper = await mountPanel(null);

    const chip = wrapper.get(".ref-chip");
    expect(chip.classes()).not.toContain("ref-chip--link");
    expect(wrapper.get(".related-work-context").text()).toContain("not linked");
    // With nothing to open, a click offers the other actions instead.
    await chip.trigger("click");
    expect(openExternal).not.toHaveBeenCalled();
    const menu = document.body.querySelector('[data-testid="work-ref-menu"]');
    expect(menu?.textContent).toContain("Copy owner/project#512");
    expect(menu?.textContent).not.toContain("Open in browser");
    wrapper.unmount();
  });

  it("copies the link or the reference, and finds other sessions, from the menu", async () => {
    respond({ refs: [contextPr("405")] });
    const wrapper = await mountPanel("github");
    const chip = wrapper.get(".ref-chip");
    const item = (label: string) =>
      [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) =>
        button.textContent?.includes(label),
      );

    await chip.trigger("contextmenu");
    item("Copy link")?.click();
    await flushPromises();
    expect(writeText).toHaveBeenLastCalledWith("https://github.com/owner/project/pull/405");

    await chip.trigger("contextmenu");
    item("Copy owner/project#405")?.click();
    await flushPromises();
    expect(writeText).toHaveBeenLastCalledWith("owner/project#405");

    await chip.trigger("contextmenu");
    item("Find sessions mentioning #405")?.click();
    await flushPromises();
    expect(pushRoute).toHaveBeenCalledWith(expect.anything(), "search", {
      query: { q: "pr:405" },
    });
    expect(document.body.querySelector('[data-testid="work-ref-menu"]')).toBeNull();
    wrapper.unmount();
  });

  it("keeps an unresolved reference as a plain label with no repository", async () => {
    respond({
      refs: [
        ref({
          identity: "bare",
          kind: "pullRequest",
          rawValue: "#7",
          normalizedValue: "7",
          resolution: "unresolved",
        }),
      ],
    });
    const wrapper = await mountPanel("github");

    const chip = wrapper.get('[data-resolution="unresolved"] .ref-chip');
    expect(chip.classes()).not.toContain("ref-chip--link");
    expect(chip.find(".ref-repo").exists()).toBe(false);
    expect(chip.get(".ref-value").text()).toBe("#7");
    wrapper.unmount();
  });

  it("links a SHA-shaped ref as a commit but never a branch name", async () => {
    respond({
      refs: [
        contextPr("c598b556", { identity: "sha", kind: "gitRef", shaShaped: true }),
        contextPr("feat/x", { identity: "branch", kind: "gitRef", shaShaped: false }),
      ],
    });
    const wrapper = await mountPanel("github");

    await wrapper.get('[data-kind="commit"] .ref-chip').trigger("click");
    expect(openExternal).toHaveBeenCalledWith("https://github.com/owner/project/commit/c598b556");
    const branch = wrapper.get('[data-kind="branch"] .ref-chip');
    expect(branch.classes()).not.toContain("ref-chip--link");
    expect(branch.text()).toBe("feat/x");
    expect(branch.attributes("title")).not.toMatch(/commit SHA/);
    wrapper.unmount();
  });

  it("offers no navigation to a turn, because the source counter has no mapping", async () => {
    respond({
      refs: [ref({ identity: "pr", resolution: "unresolved", sourceTurnIndex: 3 })],
    });
    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toMatch(/turn/i);
    wrapper.unmount();
  });

  it("stays out of the overview when there is nothing to show", async () => {
    // Neither absence claims that no such work exists; Settings reports the
    // source's availability.
    for (const response of [
      { available: false, refs: [], sourceAvailability: "missing" as const },
      { available: true, refs: [], sourceAvailability: "ready" as const },
    ]) {
      respond(response);
      const wrapper = await mountPanel();
      expect(wrapper.text()).toBe("");
      wrapper.unmount();
    }
  });

  it("marks cached references when the store could not be read", async () => {
    respond({ available: true, refs: [ref()], sourceAvailability: "busy" });
    const wrapper = await mountPanel();
    expect(wrapper.get(".related-work-message").text()).toMatch(/Showing cached references/);
  });

  it("surfaces a failed read in place", async () => {
    getSessionWorkRefs.mockRejectedValue(new Error("index locked"));
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain("index locked");
  });
});
