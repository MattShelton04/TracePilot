import type { PullRequestState } from "@tracepilot/types";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-vue-next";
import type { Component } from "vue";

/** The Lucide icon for a pull request's state; an unknown state reads as open. */
export function pullRequestIcon(state: PullRequestState | null | undefined): Component {
  switch (state) {
    case "draft":
      return GitPullRequestDraft;
    case "merged":
      return GitMerge;
    case "closed":
      return GitPullRequestClosed;
    default:
      return GitPullRequest;
  }
}
