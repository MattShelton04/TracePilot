import type { WorktreeDetails, WorktreeInfo } from "@tracepilot/types";
import { setupPinia } from "@tracepilot/test-utils";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});

describe("WorktreeToolbar", () => {
  it("emits action events when toolbar buttons clicked", async () => {
    const wrapper = mount(WorktreeToolbar, {
      props: {
        searchQuery: "",
        selectedRepoPath: null,
        refreshing: false,
        cleaningStale: false,
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
      },
    });
    const input = wrapper.find(".search-input");
    await input.setValue("foo");
    expect(wrapper.emitted("update:searchQuery")?.[0]).toEqual(["foo"]);
  });
});

describe("WorktreeList", () => {
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
