import type { SessionListItem } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionCard from "../components/SessionCard.vue";

/** Create a minimal mock session with required fields. */
function makeSession(overrides: Partial<SessionListItem> & { id: string }): SessionListItem {
  return { isRunning: false, ...overrides } as SessionListItem;
}

describe("SessionCard", () => {
  it("renders session summary", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({
          id: "test-id",
          summary: "Test session",
          repository: "org/repo",
          branch: "main",
          createdAt: "2026-01-01T00:00:00Z",
        }),
      },
    });
    expect(wrapper.text()).toContain("Test session");
    expect(wrapper.text()).toContain("org/repo");
  });

  it("shows 'Untitled Session' when no summary", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({ id: "test-id" }),
      },
    });
    expect(wrapper.text()).toContain("Untitled Session");
  });

  it("emits select on click", async () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({ id: "test-id", summary: "Test" }),
      },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("select")).toBeTruthy();
    expect(wrapper.emitted("select")?.[0][1]).toBe("test-id");
  });

  it("shows event count and turn count", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({
          id: "test-id",
          summary: "Test",
          eventCount: 100,
          turnCount: 5,
        }),
      },
    });
    expect(wrapper.text()).toContain("100");
    expect(wrapper.text()).toContain("5");
  });

  it("abbreviates large counts so the footer stays on one line, exact on hover", () => {
    const wrapper = mount(SessionCard, {
      props: { session: makeSession({ id: "big", eventCount: 12_345, turnCount: 1_153 }) },
    });
    expect(wrapper.get('[title="12,345 events"]').text()).toBe("12.3K");
    expect(wrapper.get('[title="1,153 conversation turns"]').text()).toBe("1.2K");
  });

  it("agrees the hover nouns with a count of one", () => {
    const wrapper = mount(SessionCard, {
      props: { session: makeSession({ id: "one", eventCount: 1, turnCount: 1 }) },
    });
    expect(wrapper.find('[title="1 event"]').exists()).toBe(true);
    expect(wrapper.find('[title="1 conversation turn"]').exists()).toBe(true);
  });

  it("shows relative time for updatedAt", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({
          id: "test-id",
          summary: "Test",
          updatedAt: new Date(Date.now() - 3600000).toISOString(),
        }),
      },
    });
    // Short form: the footer has no room for "ago"; the timestamp is on hover.
    expect(wrapper.get(".card-time-new").text()).toBe("1h");
  });

  it("puts the local date and time, not the raw ISO string, in the age tooltip", () => {
    const updatedAt = "2026-10-22T03:14:00.123Z";
    const wrapper = mount(SessionCard, {
      props: { session: makeSession({ id: "test-id", updatedAt }) },
    });
    const title = wrapper.get(".card-time-new").attributes("title");
    expect(title).toBe(new Date(updatedAt).toLocaleString());
    expect(title).not.toBe(updatedAt);
  });

  it("omits the age tooltip when updatedAt is missing or unreadable", () => {
    for (const updatedAt of [undefined, "not a date"]) {
      const wrapper = mount(SessionCard, {
        props: { session: makeSession({ id: "test-id", updatedAt }) },
      });
      expect(wrapper.get(".card-time-new").attributes("title")).toBeUndefined();
    }
  });

  it("shows model badge when currentModel is present", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({
          id: "test-id",
          summary: "Test",
          currentModel: "claude-opus-4.6",
        }),
      },
    });
    expect(wrapper.text()).toContain("claude-opus-4.6");
  });

  it("names a Claude Code model the way Analytics and Models do", () => {
    const badge = (session: SessionListItem) =>
      mount(SessionCard, { props: { session } }).get(".badge-done");
    const claude = badge(
      makeSession({ id: "cc", source: "claudeCode", currentModel: "claude-opus-5-5" }),
    );
    expect(claude.text()).toBe("claude-opus-5.5");
    expect(claude.attributes("title")).toBe("claude-opus-5-5");
    // Copilot ids and models the Claude registry does not know are shown as recorded.
    expect(badge(makeSession({ id: "c", currentModel: "claude-opus-5-5" })).text()).toBe(
      "claude-opus-5-5",
    );
    expect(
      badge(makeSession({ id: "u", source: "claudeCode", currentModel: "claude-next-1" })).text(),
    ).toBe("claude-next-1");
  });

  it("shows repository and branch badges", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({
          id: "test-id",
          summary: "Test",
          repository: "user/repo",
          branch: "feature-branch",
        }),
      },
    });
    expect(wrapper.text()).toContain("user/repo");
    expect(wrapper.text()).toContain("feature-branch");
  });

  it("handles missing optional fields gracefully", () => {
    const wrapper = mount(SessionCard, {
      props: {
        session: makeSession({ id: "test-id" }),
      },
    });
    // In the new design, stats icons are always visible but show 0
    expect(wrapper.text()).toContain("0");
    expect(wrapper.text()).toContain("Untitled Session");
  });

  it("badges a Copilot session and keeps its host badge", () => {
    const wrapper = mount(SessionCard, { props: { session: makeSession({ id: "c" }) } });
    const source = wrapper.get('[title="Session source"]');
    expect(source.text()).toBe("Copilot");
    expect(source.classes()).toContain("badge-copilot");
    expect(wrapper.text()).toContain("cli");
  });

  it("marks the footer with the session source's logo", () => {
    const logo = (session: SessionListItem) =>
      mount(SessionCard, { props: { session } }).get('[data-testid="session-source-logo"]');
    const copilot = logo(makeSession({ id: "c" }));
    expect(copilot.attributes("title")).toBe("Copilot");
    expect(copilot.classes()).toContain("card-source-logo--copilot");
    expect(copilot.find("svg").exists()).toBe(true);
    const claude = logo(makeSession({ id: "cc", source: "claudeCode" }));
    expect(claude.attributes("title")).toBe("Claude Code");
    expect(claude.classes()).toContain("card-source-logo--claude");
  });

  it("badges a Claude Code session instead of a default host", () => {
    const wrapper = mount(SessionCard, {
      props: { session: makeSession({ id: "cc", source: "claudeCode" }) },
    });
    expect(wrapper.get('[title="Session source"]').text()).toBe("Claude Code");
    expect(wrapper.text()).not.toContain("cli");
  });

  it("tints Claude Code session cards and their source badge with the clay palette", () => {
    const claude = mount(SessionCard, {
      props: { session: makeSession({ id: "cc", source: "claudeCode" }) },
    });
    expect(claude.classes()).toContain("session-card--claude");
    expect(claude.get('[title="Session source"]').classes()).toContain("badge-claude");

    const copilot = mount(SessionCard, { props: { session: makeSession({ id: "c" }) } });
    expect(copilot.classes()).not.toContain("session-card--claude");
  });

  it("labels a running session Active unless its source reports what it is doing", () => {
    const badge = (session: SessionListItem) => {
      const wrapper = mount(SessionCard, { props: { session } });
      const active = wrapper.find(".active-badge");
      return active.exists() ? [active.text(), active.attributes("title")] : null;
    };
    expect(badge(makeSession({ id: "idle", source: "claudeCode" }))).toBeNull();
    expect(badge(makeSession({ id: "c", isRunning: true }))).toEqual([
      "Active",
      "Session is currently active",
    ]);
    const claude = { source: "claudeCode", isRunning: true } as const;
    expect(badge(makeSession({ id: "b", ...claude, runStatus: "busy" }))).toEqual([
      "Busy",
      "Claude Code is working",
    ]);
    expect(badge(makeSession({ id: "w", ...claude, runStatus: "waiting" }))).toEqual([
      "Waiting",
      "Claude Code is waiting for input",
    ]);
    expect(badge(makeSession({ id: "u", ...claude }))?.[0]).toBe("Active");
  });

  it("styles Waiting apart from Busy and keeps the Claude tint while running", () => {
    const card = (runStatus?: "busy" | "waiting") =>
      mount(SessionCard, {
        props: {
          session: makeSession({ id: "r", source: "claudeCode", isRunning: true, runStatus }),
        },
      });
    const busy = card("busy");
    expect(busy.get(".active-badge").classes()).toContain("badge-success");
    expect(busy.classes()).toEqual(
      expect.arrayContaining(["card--active", "session-card--claude"]),
    );
    expect(busy.classes()).not.toContain("card--waiting");

    const waiting = card("waiting");
    expect(waiting.get(".active-badge").classes()).toContain("badge-warning");
    expect(waiting.classes()).toEqual(
      expect.arrayContaining(["card--active", "card--waiting", "session-card--claude"]),
    );
    expect(waiting.get(".active-dot").classes()).toContain("active-dot--waiting");
  });

  it("shows a folder chip from the cwd only when there is no repository", () => {
    const cwdOnly = mount(SessionCard, {
      props: {
        session: makeSession({ id: "cc", source: "claudeCode", cwd: "/work/synthetic/orchard" }),
      },
    });
    const chip = cwdOnly.get('[data-testid="session-project-chip"]');
    expect(chip.text()).toBe("orchard");
    expect(chip.attributes("title")).toBe("/work/synthetic/orchard");
    expect(chip.classes()).not.toContain("badge-accent");
    expect(chip.find("svg").exists()).toBe(true);

    const withRepo = mount(SessionCard, {
      props: { session: makeSession({ id: "c", repository: "org/app", cwd: "/work/app" }) },
    });
    expect(withRepo.find('[data-testid="session-project-chip"]').exists()).toBe(false);
    expect(withRepo.findAll(".badge").map((b) => b.text())).toEqual(["Copilot", "org/app", "cli"]);
  });

  it("counts rate limits apart from errors, in a warning tone", () => {
    const stats = (session: Partial<SessionListItem>) =>
      mount(SessionCard, { props: { session: makeSession({ id: "s", ...session }) } });

    // The index counts a rate limit as an error too; the card does not.
    const rateLimited = stats({ errorCount: 1, rateLimitCount: 1 });
    expect(rateLimited.find(".stat-item-inline.error").exists()).toBe(false);
    const limit = rateLimited.get('[data-testid="session-rate-limits"]');
    expect(limit.classes()).toContain("warning");
    expect(limit.text()).toBe("1");
    expect(limit.attributes("title")).toBe("1 rate limit hit");

    const both = stats({ errorCount: 3, rateLimitCount: 1 });
    const errors = both.get(".stat-item-inline.error");
    expect(errors.text()).toBe("2");
    expect(errors.attributes("title")).toBe("2 errors encountered");
    expect(both.get('[data-testid="session-rate-limits"]').text()).toBe("1");

    // Without a rate-limit count, errors show as recorded.
    const unsplit = stats({ errorCount: 2 });
    expect(unsplit.get(".stat-item-inline.error").text()).toBe("2");
    expect(unsplit.find('[data-testid="session-rate-limits"]').exists()).toBe(false);
  });

  it("shows the primary pull request in the footer, coloured by its state", () => {
    const card = (linkedPullRequests: SessionListItem["linkedPullRequests"]) =>
      mount(SessionCard, { props: { session: makeSession({ id: "s", linkedPullRequests }) } });
    const primary = {
      host: "github.com",
      owner: "example",
      repo: "orchard",
      number: 1046,
      url: "https://github.com/example/orchard/pull/1046",
      state: null,
    };

    expect(card(null).find('[data-testid="session-pull-requests"]').exists()).toBe(false);

    // Unknown state: neutral, no count for a single pull request.
    const single = card({ count: 1, primary, pullRequests: [] }).get(
      '[data-testid="session-pull-requests"]',
    );
    expect(single.text()).toBe("#1046");
    expect(single.classes()).toContain("pr-stat--neutral");
    expect(single.attributes("title")).toBe("example/orchard#1046");
    // It sits in the footer stats, not the badge row.
    expect(single.element.closest(".card-stats-new")).not.toBeNull();

    const several = card({
      count: 3,
      primary: { ...primary, state: "merged" },
      pullRequests: [],
    }).get('[data-testid="session-pull-requests"]');
    expect(several.get(".pr-stat__number").text()).toBe("#1046");
    expect(several.get(".pr-stat__more").text()).toBe("+2");
    expect(several.classes()).toContain("pr-stat--done");
    expect(several.attributes("title")).toBe(
      "example/orchard#1046 · Merged\n+2 more linked pull requests",
    );
  });
});
