import { EXTERNAL_LINK_HANDLER_KEY } from "@tracepilot/ui";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionDetailHeader from "@/components/session/SessionDetailHeader.vue";
import SessionPullRequestChip from "@/components/session/SessionPullRequestChip.vue";
import { makePullRequest } from "../../utils/pullRequestFixtures";

const mocks = vi.hoisted(() => ({ copy: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock("@tracepilot/ui", async (original) => {
  const module = await original<typeof import("@tracepilot/ui")>();
  const { ref } = await import("vue");
  return {
    ...module,
    useClipboard: () => ({ copy: mocks.copy, copied: ref(false) }),
    useToast: () => ({ success: mocks.success, error: mocks.error, warning: vi.fn() }),
  };
});

const created = makePullRequest(1046, ["created"], {
  primary: true,
  title: "Retry index writes",
  headRef: "fix/retry",
  baseRef: "main",
});
const merged = makePullRequest(1031, ["merged"], { title: "Pin the busy timeout" });
const reviewed = makePullRequest(1012, ["reviewed"]);

function mountChip(
  pullRequests = [created],
  openExternal: ((url: string) => void) | null = vi.fn(),
) {
  return mount(SessionPullRequestChip, {
    props: { pullRequests },
    attachTo: document.body,
    global: {
      provide: openExternal ? { [EXTERNAL_LINK_HANDLER_KEY as symbol]: openExternal } : {},
    },
  });
}

describe("SessionPullRequestChip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.copy.mockResolvedValue(true);
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is absent from the header when the session links none", () => {
    const header = mount(SessionDetailHeader, {
      props: {
        detail: {
          id: "s",
          source: "copilot",
          hasPlan: false,
          hasCheckpoints: false,
          branch: "main",
        },
        source: "copilot",
        sourceName: "Copilot",
        active: false,
        waiting: false,
        liveBadge: { label: "Active", title: "" },
        pullRequests: [],
      },
    });
    expect(header.find('[data-testid="session-pull-request-chip"]').exists()).toBe(false);
  });

  it("shows the primary pull request after the branch and opens it", async () => {
    const open = vi.fn();
    const header = mount(SessionDetailHeader, {
      props: {
        detail: {
          id: "s",
          source: "copilot",
          hasPlan: false,
          hasCheckpoints: false,
          branch: "main",
        },
        source: "copilot",
        sourceName: "Copilot",
        active: false,
        waiting: false,
        liveBadge: { label: "Active", title: "" },
        pullRequests: [created],
      },
      global: { provide: { [EXTERNAL_LINK_HANDLER_KEY as symbol]: open } },
    });
    const badges = header.get(".detail-badges");
    const chip = badges.get('[data-testid="session-pull-request-chip"]');
    expect(chip.element.previousElementSibling?.textContent).toBe("main");
    expect(chip.text()).toBe("#1046");
    expect(chip.find(".badge").attributes("title")).toBe(
      "example/orchard#1046 — Retry index writes\nfix/retry → main\nCreated in this session",
    );
    expect(chip.find('[data-testid="session-pull-request-more"]').exists()).toBe(false);
    const button = chip.get("button");
    expect(button.attributes("aria-label")).toBe("Open pull request example/orchard#1046");
    await button.trigger("click");
    expect(open).toHaveBeenCalledWith(created.url);
  });

  it("colours the chip by state and names a known state", () => {
    const tone = (state: "open" | "draft" | "merged" | "closed" | null) => {
      const status = state
        ? {
            state,
            title: null,
            mergedAt: null,
            closedAt: null,
            reviewDecision: null,
            checksState: null,
            fetchedAt: "2026-01-01T00:00:00Z",
            error: null,
          }
        : null;
      const badge = mountChip([{ ...created, status }]).get(".badge");
      const text = badge.findAll("span").map((span) => span.text());
      return { cls: badge.classes().find((c) => c.startsWith("badge-")), text: text.join(" ") };
    };
    expect(tone(null)).toEqual({ cls: "badge-neutral", text: "#1046" });
    expect(tone("open")).toEqual({ cls: "badge-success", text: "#1046 Open" });
    expect(tone("draft")).toEqual({ cls: "badge-neutral", text: "#1046 Draft" });
    expect(tone("merged")).toEqual({ cls: "badge-done", text: "#1046 Merged" });
    expect(tone("closed")).toEqual({ cls: "badge-danger", text: "#1046 Closed" });
  });

  it("lists the other pull requests behind +N and opens the chosen one", async () => {
    const open = vi.fn();
    const wrapper = mountChip([created, merged, reviewed], open);
    const more = wrapper.get('[data-testid="session-pull-request-more"]');
    expect(more.text()).toBe("+2");
    expect(more.attributes("aria-haspopup")).toBe("menu");
    expect(more.attributes("aria-expanded")).toBe("false");

    await more.trigger("click");
    await flushPromises();
    expect(more.attributes("aria-expanded")).toBe("true");
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(items.map((item) => item.querySelector(".pr-menu__slug")?.textContent)).toEqual([
      "example/orchard#1031",
      "example/orchard#1012",
    ]);
    items[1].click();
    await flushPromises();
    expect(open).toHaveBeenCalledWith(reviewed.url);
    expect(document.querySelector('[data-testid="pull-request-menu"]')).toBeNull();
    wrapper.unmount();
  });

  it("copies the link where the window cannot open the browser", async () => {
    const wrapper = mountChip([created], null);
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(mocks.copy).toHaveBeenCalledWith(created.url);
    expect(mocks.success).toHaveBeenCalledWith("Link copied", {
      description: "Pop-out windows can't open the browser.",
    });
  });
});
