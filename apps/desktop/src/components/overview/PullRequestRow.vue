<script setup lang="ts">
/**
 * One linked pull request on the Overview: title, `owner/repo#n`, state once
 * known, branches, what the session did and when it first linked it.
 */
import {
  formatRelativeTime,
  pullRequestRoleLabel,
  pullRequestSlug,
  pullRequestStateLabel,
  pullRequestTone,
  type SessionPullRequest,
  sessionPullRequestState,
  sessionPullRequestTitle,
} from "@tracepilot/types";
import { Badge, pullRequestIcon, StatusPill } from "@tracepilot/ui";
import { Copy, ExternalLink, MessageSquare } from "lucide-vue-next";
import { computed } from "vue";
import { pullRequestBranches } from "@/utils/pullRequests";

const props = defineProps<{
  pr: SessionPullRequest;
  /** False in pop-out windows, where Open copies the link instead. */
  canOpen: boolean;
}>();

const emit = defineEmits<{ open: []; copy: []; jump: [] }>();

const state = computed(() => sessionPullRequestState(props.pr));
const stateLabel = computed(() => pullRequestStateLabel(state.value));
const title = computed(
  () => sessionPullRequestTitle(props.pr) ?? `Pull request #${props.pr.number}`,
);
const branches = computed(() => pullRequestBranches(props.pr));
const linkedAt = computed(() => formatRelativeTime(props.pr.firstSeenAt));
const linkedAtTitle = computed(() =>
  props.pr.firstSeenAt ? new Date(props.pr.firstSeenAt).toLocaleString() : undefined,
);
</script>

<template>
  <li class="pr-row" data-testid="pull-request-row">
    <component
      :is="pullRequestIcon(state)"
      :size="16"
      aria-hidden="true"
      class="pr-row__icon"
      :class="`pr-row__icon--${pullRequestTone(state)}`"
    />
    <div class="pr-row__main">
      <div class="pr-row__head">
        <span class="pr-row__title" :title="title">{{ title }}</span>
        <StatusPill v-if="stateLabel" :tone="pullRequestTone(state)" :label="stateLabel" size="xs" />
      </div>
      <div class="pr-row__meta">
        <span class="pr-row__mono">{{ pullRequestSlug(pr) }}</span>
        <span v-if="branches" class="pr-row__mono pr-row__branches" :title="branches">{{ branches }}</span>
        <span class="pr-row__roles">
          <Badge v-for="role in pr.roles" :key="role" variant="neutral">{{ pullRequestRoleLabel(role) }}</Badge>
        </span>
        <span v-if="linkedAt" class="pr-row__time" :title="linkedAtTitle">Linked {{ linkedAt }}</span>
        <slot name="related" />
      </div>
    </div>
    <div class="pr-row__actions">
      <button
        v-if="pr.eventIndex != null"
        type="button"
        class="btn btn-sm btn-ghost"
        data-testid="pull-request-jump"
        @click="emit('jump')"
      >
        <MessageSquare :size="14" aria-hidden="true" />
        Show in conversation
      </button>
      <button type="button" class="btn btn-sm btn-ghost" data-testid="pull-request-copy" @click="emit('copy')">
        <Copy :size="14" aria-hidden="true" />
        Copy link
      </button>
      <button
        v-if="canOpen"
        type="button"
        class="btn btn-sm btn-ghost"
        data-testid="pull-request-open"
        @click="emit('open')"
      >
        <ExternalLink :size="14" aria-hidden="true" />
        Open
      </button>
    </div>
  </li>
</template>

<style scoped>
.pr-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.pr-row:last-child {
  border-bottom: none;
}

.pr-row__icon {
  align-self: start;
  margin-top: 2px;
  color: var(--text-tertiary);
}
.pr-row__icon--success {
  color: var(--success-fg);
}
.pr-row__icon--done {
  color: var(--done-fg);
}
.pr-row__icon--danger {
  color: var(--danger-fg);
}

.pr-row__main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.pr-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pr-row__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 18px;
  font-weight: 500;
  color: var(--text-primary);
}

.pr-row__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  min-width: 0;
  font-size: 12px;
  line-height: 16px;
  color: var(--text-tertiary);
}

.pr-row__mono {
  font-family: var(--font-mono);
  color: var(--text-secondary);
}

.pr-row__branches {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pr-row__roles {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pr-row__time {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pr-row__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}

/* Narrow Overviews put the actions under the details. */
@container (max-width: 760px) {
  .pr-row {
    grid-template-columns: 16px minmax(0, 1fr);
  }
  .pr-row__actions {
    grid-column: 2;
    justify-content: flex-start;
    margin-left: -8px;
  }
}
</style>
