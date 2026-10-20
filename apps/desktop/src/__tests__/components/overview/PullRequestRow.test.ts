import type { PullRequestStatus, SessionPullRequest } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { makePullRequest } from "@/__tests__/utils/pullRequestFixtures";
import PullRequestRow from "@/components/overview/PullRequestRow.vue";

function status(fields: Partial<PullRequestStatus>): PullRequestStatus {
  return {
    state: "open",
    title: null,
    mergedAt: null,
    closedAt: null,
    reviewDecision: null,
    checksState: null,
    fetchedAt: "2026-10-01T00:00:00Z",
    error: null,
    ...fields,
  };
}

function mountRow(pr: SessionPullRequest) {
  return mount(PullRequestRow, { props: { pr, canOpen: true } });
}

describe("PullRequestRow", () => {
  it.each([
    ["success", "Checks passing", "success"],
    ["failure", "Checks failing", "danger"],
    ["error", "Checks failing", "danger"],
    ["pending", "Checks pending", "warning"],
    ["expected", "Checks pending", "warning"],
  ])("shows %s checks as %s in the %s tone", (checksState, label, tone) => {
    const row = mountRow(makePullRequest(1, ["created"], { status: status({ checksState }) }));
    const checks = row.get('[data-testid="pull-request-checks"]');
    expect(checks.text()).toBe(label);
    expect(checks.classes()).toContain(`pr-row__checks--${tone}`);
    expect(checks.find("svg").exists()).toBe(true);
  });

  it("shows the review decision while open or draft", () => {
    const open = mountRow(
      makePullRequest(1, ["created"], {
        status: status({ reviewDecision: "changes_requested", checksState: "success" }),
      }),
    );
    expect(open.get('[data-testid="pull-request-review"]').text()).toBe("Changes requested");
    const draft = mountRow(
      makePullRequest(1, ["created"], {
        status: status({ state: "draft", reviewDecision: "review_required" }),
      }),
    );
    expect(draft.get('[data-testid="pull-request-review"]').text()).toBe("Review required");
  });

  it("leaves checks and review out once merged or closed", () => {
    for (const state of ["merged", "closed"] as const) {
      const row = mountRow(
        makePullRequest(1, ["merged"], {
          status: status({ state, reviewDecision: "approved", checksState: "failure" }),
        }),
      );
      expect(row.find('[data-testid="pull-request-checks"]').exists()).toBe(false);
      expect(row.find('[data-testid="pull-request-review"]').exists()).toBe(false);
    }
  });

  it("ignores rollups and decisions it doesn't know", () => {
    const row = mountRow(
      makePullRequest(1, ["created"], {
        status: status({ reviewDecision: "dismissed", checksState: "skipped" }),
      }),
    );
    expect(row.find('[data-testid="pull-request-checks"]').exists()).toBe(false);
    expect(row.find('[data-testid="pull-request-review"]').exists()).toBe(false);
  });

  it("titles the row with GitHub's title over the transcript's", () => {
    const row = mountRow(
      makePullRequest(1, ["created"], {
        title: "Working title",
        status: status({ title: "Final title" }),
      }),
    );
    expect(row.get(".pr-row__title").text()).toBe("Final title");
  });

  it("hints that an Updated role came from a pushed branch", () => {
    const row = mountRow(makePullRequest(1, ["updated"], { foundByBranch: true }));
    const badge = row.get("[data-from-branch]");
    expect(badge.text()).toBe("Updated");
    expect(badge.attributes("title")).toBe("Found from a branch this session pushed");
    expect(badge.find("svg").exists()).toBe(true);

    const fromTranscript = mountRow(makePullRequest(1, ["updated"]));
    expect(fromTranscript.find("[data-from-branch]").exists()).toBe(false);
    // Other roles of a branch-found pull request get no hint.
    const merged = mountRow(makePullRequest(1, ["merged"], { foundByBranch: true }));
    expect(merged.find("[data-from-branch]").exists()).toBe(false);
  });

  it("stays neutral when GitHub couldn't be asked about it", () => {
    const row = mountRow(
      makePullRequest(7, ["reviewed"], {
        status: status({ state: null, error: "Could not resolve to a PullRequest" }),
      }),
    );
    expect(row.findComponent({ name: "StatusPill" }).exists()).toBe(false);
    expect(row.get(".pr-row__icon").classes()).toContain("pr-row__icon--neutral");
    expect(row.find('[data-testid="pull-request-checks"]').exists()).toBe(false);
    expect(row.get(".pr-row__title").attributes("title")).toBe(
      "Pull request #7\nCouldn't look this up on GitHub",
    );
    expect(row.text()).not.toContain("Could not resolve");
  });
});
