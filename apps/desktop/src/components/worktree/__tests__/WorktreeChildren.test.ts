import { setupPinia } from "@tracepilot/test-utils";
import type { WorktreeDetails, WorktreeInfo } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { useWorktreesStore } from "@/stores/worktrees";

vi.mock("@tracepilot/ui", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@tracepilot/ui");
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      show: vi.fn(),
      dismiss: vi.fn(),
    }),
    useConfirmDialog: () => ({
      confirm: vi.fn().mockResolvedValue({ confirmed: false, checked: false }),
    }),
  };
});

import CreateWorktreeModal from "../CreateWorktreeModal.vue";
import WorktreeDetailPanel from "../WorktreeDetailPanel.vue";
import WorktreeList from "../WorktreeList.vue";
import WorktreeRepoSidebar from "../WorktreeRepoSidebar.vue";
import WorktreeToolbar from "../WorktreeToolbar.vue";

function makeWt(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    path: "/repo/wt-a",
    branch: "feature/a",
    repoRoot: "/repo",
    status: "active",
    isMainWorktree: false,
    isLocked: false,
    lockedReason: undefined,
    linkedSessionId: undefined,
    diskUsageBytes: 1000,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as WorktreeInfo;
}

function makeDetails(overrides: Partial<WorktreeDetails> = {}): WorktreeDetails {
  return {
    uncommittedCount: 0,
    ahead: 0,
    behind: 0,
    ...overrides,
  } as WorktreeDetails;
}

beforeEach(() => {
  setupPinia();
});

describe("WorktreeRepoSidebar", () => {
  it("emits add-repo / discover-repos from action buttons", async () => {
    const wrapper = mount(WorktreeRepoSidebar, {
      props: {
        selectedRepoPath: null,
        loaded: false,
        worktreeCountByRepo: new Map(),
      },
    });
    const btns = wrapper.findAll(".repo-action-btn");
    await btns[0]!.trigger("click");
    await btns[1]!.trigger("click");
    expect(wrapper.emitted("add-repo")).toBeTruthy();
    expect(wrapper.emitted("discover-repos")).toBeTruthy();
  });

  it("separates repository selection from named favourite and remove buttons", async () => {
    const store = useWorktreesStore();
    store.registeredRepos = [
      {
        path: "/repo",
        name: "Project with a long name",
        favourite: false,
        addedAt: "2026-01-01T00:00:00Z",
        source: "manual",
      },
    ];
    const favourite = vi.spyOn(store, "toggleFavourite").mockResolvedValue(undefined);
    const wrapper = mount(WorktreeRepoSidebar, {
      props: { selectedRepoPath: null, loaded: true, worktreeCountByRepo: new Map([["/repo", 2]]) },
    });
    const selectors = wrapper.findAll("button.tree-select");
    expect(selectors).toHaveLength(2);
    expect(selectors[0].attributes("aria-pressed")).toBe("true");
    await selectors[1].trigger("click");
    expect(wrapper.emitted("select-repo")).toEqual([["/repo"]]);
    await wrapper.setProps({ selectedRepoPath: "/repo" });
    expect(selectors[1].attributes("aria-pressed")).toBe("true");
    await wrapper.get('[aria-label="Add Project with a long name to favourites"]').trigger("click");
    expect(favourite).toHaveBeenCalledWith("/repo");
    await wrapper.get('[aria-label="Remove repository Project with a long name"]').trigger("click");
    expect(wrapper.emitted("remove-repo")).toEqual([["/repo"]]);
    expect(wrapper.emitted("select-repo")).toHaveLength(1);
    expect(wrapper.find("button button").exists()).toBe(false);
  });
});

const EMPTY_SUMMARY = { total: 0, active: 0, stale: 0, locked: 0, diskBytes: 0 };

describe("WorktreeToolbar", () => {
  it("shows the summary it is given, not every repository's totals", async () => {
    const store = useWorktreesStore();
    store.worktrees = [
      makeWt({ path: "/other/a", repoRoot: "/other", diskUsageBytes: 5_000_000 }),
      makeWt({ path: "/other/b", repoRoot: "/other", status: "stale", isLocked: true }),
    ];
    const wrapper = mount(WorktreeToolbar, {
      props: {
        searchQuery: "",
        selectedRepoPath: "/repo",
        refreshing: false,
        cleaningStale: false,
        cleanableStaleCount: 0,
        summary: EMPTY_SUMMARY,
      },
    });
    const summary = wrapper.get(".toolbar-summary");
    const items = () => summary.findAll(".summary-item").map((item) => item.text());
    expect(items()).toEqual(["Total: 0", "Active: 0", "Stale: 0", "0", "Disk: 0 B"]);
    expect(summary.attributes("title")).toBe("Worktrees in this repository");
    await wrapper.setProps({
      selectedRepoPath: null,
      summary: { total: 3, active: 1, stale: 2, locked: 1, diskBytes: 2048 },
    });
    expect(items()).toEqual(["Total: 3", "Active: 1", "Stale: 2", "1", "Disk: 2 KB"]);
    expect(summary.attributes("title")).toBe("Worktrees in all repositories");
  });

  it("emits action events when toolbar buttons clicked", async () => {
    const wrapper = mount(WorktreeToolbar, {
      props: {
        searchQuery: "",
        selectedRepoPath: null,
        refreshing: false,
        cleaningStale: false,
        cleanableStaleCount: 0,
        summary: EMPTY_SUMMARY,
      },
    });
    const buttons = wrapper.findAll(".toolbar > button");
    await buttons[0]!.trigger("click");
    await buttons[2]!.trigger("click");
    await buttons[3]!.trigger("click");
    expect(wrapper.emitted("create")).toBeTruthy();
    expect(wrapper.emitted("prune")).toBeTruthy();
    expect(wrapper.emitted("refresh")).toBeTruthy();
  });

  it("emits update:searchQuery on input", async () => {
    const wrapper = mount(WorktreeToolbar, {
      props: {
        searchQuery: "",
        selectedRepoPath: null,
        refreshing: false,
        cleaningStale: false,
        cleanableStaleCount: 0,
        summary: EMPTY_SUMMARY,
      },
    });
    const input = wrapper.find(".search-input");
    await input.setValue("foo");
    expect(wrapper.emitted("update:searchQuery")?.[0]).toEqual(["foo"]);
  });

  it("enables Clean Stale from the scoped count, not the global stale total", async () => {
    const store = useWorktreesStore();
    store.worktrees = [makeWt({ status: "stale", repoRoot: "/other" })];
    const props = {
      searchQuery: "",
      selectedRepoPath: "/repo",
      refreshing: false,
      cleaningStale: false,
      cleanableStaleCount: 0,
      summary: EMPTY_SUMMARY,
    };
    const wrapper = mount(WorktreeToolbar, { props });
    const clean = () => wrapper.findAll(".toolbar > button")[1]!;
    expect(clean().attributes("disabled")).toBeDefined();
    await wrapper.setProps({ cleanableStaleCount: 2 });
    expect(clean().attributes("disabled")).toBeUndefined();
    await clean().trigger("click");
    expect(wrapper.emitted("clean-stale")).toHaveLength(1);
  });
});

describe("WorktreeList", () => {
  it("uses real sortable column buttons and exposes the current ordering", async () => {
    const store = useWorktreesStore();
    const wrapper = mount(WorktreeList, {
      props: { filteredWorktrees: [makeWt()], selectedWorktreePath: null, searchQuery: "" },
    });
    const headings = wrapper.findAll("th");
    expect(headings[1].attributes("aria-sort")).toBe("ascending");
    await headings[1].get("button").trigger("click");
    expect(store.sortDirection).toBe("desc");
    expect(headings[1].attributes("aria-sort")).toBe("descending");
    await headings[3].get("button").trigger("click");
    expect(store.sortBy).toBe("diskUsageBytes");
    expect(headings[1].attributes("aria-sort")).toBe("none");
    expect(headings[3].attributes("aria-sort")).toBe("ascending");
    expect(wrapper.get("table").findAll("tbody tr td")).toHaveLength(headings.length);
    expect(wrapper.get(".wt-list").find("thead").exists()).toBe(true);
  });

  it("offers a detail button while keeping session and row actions independent", async () => {
    const wt = makeWt({ linkedSessionId: "session-123" });
    const wrapper = mount(WorktreeList, {
      props: { filteredWorktrees: [wt], selectedWorktreePath: null, searchQuery: "" },
    });
    const details = wrapper.get('button[aria-label="Details for feature/a"]');
    expect(details.attributes("aria-expanded")).toBe("false");
    await details.trigger("click");
    expect(wrapper.emitted("select")).toEqual([[wt]]);
    await wrapper.setProps({ selectedWorktreePath: wt.path });
    expect(details.attributes("aria-expanded")).toBe("true");
    await wrapper.get('button[aria-label="Open session session-123"]').trigger("click");
    await wrapper.get('button[aria-label="Open Folder"]').trigger("click");
    expect(wrapper.emitted("navigate-session")).toEqual([["session-123"]]);
    expect(wrapper.emitted("open-explorer")).toEqual([[wt.path]]);
    expect(wrapper.emitted("select")).toHaveLength(1);
    expect(wrapper.find("button button").exists()).toBe(false);
  });

  it("renders rows and emits select on row click", async () => {
    const wt = makeWt();
    const wrapper = mount(WorktreeList, {
      props: {
        filteredWorktrees: [wt],
        selectedWorktreePath: null,
        searchQuery: "",
      },
    });
    expect(wrapper.findAll(".wt-row")).toHaveLength(1);
    await wrapper.find(".wt-row").trigger("click");
    expect(wrapper.emitted("select")?.[0]).toEqual([wt]);
  });

  it("shows empty rows state when list is empty", () => {
    const wrapper = mount(WorktreeList, {
      props: {
        filteredWorktrees: [],
        selectedWorktreePath: null,
        searchQuery: "",
      },
    });
    expect(wrapper.text()).toContain("No worktrees found");
  });

  it("names lock and remove actions for their worktree", () => {
    const wrapper = mount(WorktreeList, {
      props: {
        filteredWorktrees: [makeWt()],
        selectedWorktreePath: null,
        searchQuery: "",
      },
    });

    const lock = wrapper.get('[aria-label="Lock worktree feature/a"]');
    const remove = wrapper.get('[aria-label="Remove worktree feature/a"]');
    expect(lock.get("svg").attributes("aria-hidden")).toBe("true");
    expect(remove.get("svg").attributes("aria-hidden")).toBe("true");
  });

  it("disables folder actions on a stale row and says why", async () => {
    const wrapper = mount(WorktreeList, {
      props: {
        filteredWorktrees: [makeWt({ status: "stale" })],
        selectedWorktreePath: null,
        searchQuery: "",
      },
    });
    for (const action of ["Open Folder", "Open Terminal", "Launch Session Here"]) {
      const btn = wrapper.get(`[aria-label="${action}: folder no longer exists"]`);
      expect(btn.attributes("disabled")).toBeDefined();
      expect(btn.attributes("title")).toBe("Folder no longer exists");
      await btn.trigger("click");
    }
    expect(wrapper.emitted("open-explorer")).toBeUndefined();
    expect(wrapper.emitted("open-terminal")).toBeUndefined();
    expect(wrapper.emitted("navigate-launcher")).toBeUndefined();
    // Removing the stale entry stays available.
    expect(
      wrapper.get('[aria-label="Remove worktree feature/a"]').attributes("disabled"),
    ).toBeUndefined();
  });
});

describe("WorktreeDetailPanel", () => {
  it("renders selected worktree details and emits close", async () => {
    const wt = makeWt({ branch: "main", isMainWorktree: true });
    const wrapper = mount(WorktreeDetailPanel, {
      props: {
        worktree: wt,
        details: makeDetails({ uncommittedCount: 2, ahead: 1, behind: 3 }),
        detailsLoading: false,
      },
    });
    expect(wrapper.text()).toContain("main");
    expect(wrapper.text()).toContain("Uncommitted");
    await wrapper.find(".detail-header .icon-btn").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("disables folder actions for a stale worktree", () => {
    const wrapper = mount(WorktreeDetailPanel, {
      props: { worktree: makeWt({ status: "stale" }), details: null, detailsLoading: false },
    });
    const buttons = wrapper.findAll(".detail-actions button");
    for (const label of ["Open Folder", "Open Terminal", "Launch Session Here"]) {
      const btn = buttons.find((b) => b.text() === label)!;
      expect(btn.attributes("disabled")).toBeDefined();
      expect(btn.attributes("title")).toBe("Folder no longer exists");
    }
    const active = mount(WorktreeDetailPanel, {
      props: { worktree: makeWt(), details: null, detailsLoading: false },
    });
    const open = active.findAll(".detail-actions button").find((b) => b.text() === "Open Folder")!;
    expect(open.attributes("disabled")).toBeUndefined();
  });
});

describe("CreateWorktreeModal", () => {
  it("is hidden when modelValue is false", () => {
    const wrapper = mount(CreateWorktreeModal, {
      props: {
        modelValue: false,
        lockedRepoPath: null,
        initialRepoPath: "",
      },
      attachTo: document.body,
    });
    expect(document.querySelector(".modal-dialog")).toBeNull();
    wrapper.unmount();
  });

  it("emits update:modelValue=false when cancel button is clicked", async () => {
    const wrapper = mount(CreateWorktreeModal, {
      props: {
        modelValue: true,
        lockedRepoPath: "/repo",
        initialRepoPath: "/repo",
      },
      attachTo: document.body,
    });
    await nextTick();
    const cancelBtn = document.querySelector(".modal-footer .btn") as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([false]);
    wrapper.unmount();
  });
});
