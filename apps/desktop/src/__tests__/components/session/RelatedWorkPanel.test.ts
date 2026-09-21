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

async function mountPanel() {
  const wrapper = mount(RelatedWorkPanel, { props: { sessionId: "session-a" } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  enrichmentEnabled = true;
  getSessionWorkRefs.mockReset();
  openExternal.mockReset();
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

  it("opens an explicit reference through the validated external-link path", async () => {
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
    const wrapper = await mountPanel();

    const row = wrapper.get('[data-resolution="explicit"]');
    expect(row.text()).toContain("Pull request");
    expect(row.text()).toContain("#844");
    expect(row.text()).toContain("Explicit reference");

    const link = row.get("a.ref-link");
    await link.trigger("click");
    // The recorded host is used verbatim; github.com is never assumed.
    expect(openExternal).toHaveBeenCalledWith("https://github.example.com/owner/project/pull/844");
  });

  it("builds a link from the reference's own host, never a default one", async () => {
    respond({
      refs: [
        ref({
          identity: "issue",
          kind: "issue",
          rawValue: "GHE-512",
          normalizedValue: "512",
          resolvedHost: "ghe.corp.example",
          resolvedRepository: "owner/project",
          resolution: "explicit",
        }),
      ],
    });
    const wrapper = await mountPanel();

    await wrapper.get("a.ref-link").trigger("click");
    expect(openExternal).toHaveBeenCalledWith("https://ghe.corp.example/owner/project/issues/512");
    expect(openExternal).not.toHaveBeenCalledWith(expect.stringContaining("github.com"));
  });

  it("shows a session-context repository as unverified context, not a link", async () => {
    respond({
      refs: [
        ref({
          identity: "ctx",
          kind: "issue",
          rawValue: "#512",
          normalizedValue: "512",
          resolvedHost: null,
          resolvedRepository: "owner/project",
          candidateRepository: "owner/project",
          resolution: "sessionContext",
        }),
      ],
    });
    const wrapper = await mountPanel();

    const row = wrapper.get('[data-resolution="sessionContext"]');
    expect(row.find("a.ref-link").exists()).toBe(false);
    expect(row.get(".ref-repo-unverified").text()).toBe("owner/project (unverified)");
    expect(row.text()).toContain("Unverified repository");
  });

  it("keeps an unresolved reference as a searchable label with no repository", async () => {
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
    const wrapper = await mountPanel();

    const row = wrapper.get('[data-resolution="unresolved"]');
    expect(row.find("a.ref-link").exists()).toBe(false);
    expect(row.find(".ref-repo").exists()).toBe(false);
    expect(row.get(".ref-plain").text()).toBe("#7");
    expect(row.text()).toContain("Unresolved");
  });

  it("labels a git ref as a git ref and never as a commit when it is not SHA-shaped", async () => {
    respond({
      refs: [
        ref({
          identity: "branch",
          kind: "gitRef",
          rawValue: "feat/session-store-enrichment",
          normalizedValue: "feat/session-store-enrichment",
          candidateRepository: "owner/project",
          resolution: "sessionContext",
          shaShaped: false,
        }),
      ],
    });
    const wrapper = await mountPanel();

    const row = wrapper.get(".related-work-row");
    expect(row.get(".ref-kind").text()).toBe("Git ref");
    expect(row.get(".ref-plain").text()).toBe("feat/session-store-enrichment");
    expect(row.find(".ref-note").exists()).toBe(false);
    expect(row.text()).not.toMatch(/commit/i);
  });

  it("calls a SHA-shaped git ref a candidate commit, not a verified one", async () => {
    respond({
      refs: [
        ref({
          identity: "sha",
          kind: "gitRef",
          rawValue: "c598b556",
          normalizedValue: "c598b556",
          resolution: "unresolved",
          shaShaped: true,
        }),
      ],
    });
    const wrapper = await mountPanel();

    const note = wrapper.get(".ref-note").text();
    expect(note).toMatch(/candidate commit/i);
    expect(note).toMatch(/no commit was verified/i);
  });

  it("offers no navigation to a turn, because the source counter has no mapping", async () => {
    respond({
      refs: [ref({ identity: "pr", resolution: "unresolved", sourceTurnIndex: 3 })],
    });
    const wrapper = await mountPanel();

    expect(wrapper.text()).not.toMatch(/turn/i);
    expect(wrapper.findAll("button")).toHaveLength(0);
  });

  it("says the source is unavailable rather than that there is no linked work", async () => {
    respond({ available: false, refs: [], sourceAvailability: "missing" });
    const wrapper = await mountPanel();

    const message = wrapper.get(".related-work-unavailable").text();
    expect(message).toMatch(/source is unavailable/i);
    expect(message).toMatch(/not the same as this session having no linked work/i);
    expect(message).toMatch(/No Copilot session store was found/i);
    expect(wrapper.find(".related-work-list").exists()).toBe(false);
  });

  it("distinguishes an available source that recorded nothing", async () => {
    respond({ available: true, refs: [], sourceAvailability: "ready" });
    const wrapper = await mountPanel();

    expect(wrapper.find(".related-work-unavailable").exists()).toBe(false);
    expect(wrapper.get(".related-work-message").text()).toMatch(/recorded no references/i);
  });
});
