<script setup lang="ts">
/**
 * SessionPullRequestChip — the header's link to the session's primary pull
 * request, coloured by its state once known, and a "+N" chip listing the
 * others. Clicking opens the pull request (pop-out windows copy its link).
 */
import {
  pullRequestSlug,
  pullRequestStateLabel,
  pullRequestTone,
  type SessionPullRequest,
  sessionPullRequestState,
} from "@tracepilot/types";
import { Badge, pullRequestIcon } from "@tracepilot/ui";
import { computed, ref } from "vue";
import PullRequestMenu from "@/components/session/PullRequestMenu.vue";
import { usePullRequestLinks } from "@/composables/usePullRequestLinks";
import { primaryPullRequest, pullRequestTooltip } from "@/utils/pullRequests";

const props = defineProps<{ pullRequests: SessionPullRequest[] }>();

const { open } = usePullRequestLinks();

const primary = computed(() => primaryPullRequest(props.pullRequests));
const others = computed(() => props.pullRequests.filter((pr) => pr !== primary.value));
const state = computed(() => (primary.value ? sessionPullRequestState(primary.value) : null));
const stateLabel = computed(() => pullRequestStateLabel(state.value));

const menuOpen = ref(false);
const menuPosition = ref({ x: 0, y: 0 });
const moreButton = ref<HTMLButtonElement | null>(null);

function toggleMenu() {
  if (menuOpen.value) {
    menuOpen.value = false;
    return;
  }
  const rect = moreButton.value?.getBoundingClientRect();
  menuPosition.value = rect ? { x: rect.left, y: rect.bottom + 4 } : { x: 0, y: 0 };
  menuOpen.value = true;
}

function select(pr: SessionPullRequest) {
  menuOpen.value = false;
  void open(pr.url);
}
</script>

<template>
  <span v-if="primary" class="pr-chips" data-testid="session-pull-request-chip">
    <button
      type="button"
      class="pr-chip"
      :aria-label="`Open pull request ${pullRequestSlug(primary)}${stateLabel ? `, ${stateLabel}` : ''}`"
      @click="open(primary.url)"
    >
      <Badge :variant="pullRequestTone(state)" :title="pullRequestTooltip(primary)">
        <component :is="pullRequestIcon(state)" :size="12" aria-hidden="true" class="pr-chip__icon" />
        <span class="pr-chip__number">#{{ primary.number }}</span>
        <span v-if="stateLabel">{{ stateLabel }}</span>
      </Badge>
    </button>
    <button
      v-if="others.length"
      ref="moreButton"
      type="button"
      class="pr-chip"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      :aria-label="`${others.length} more linked pull request${others.length === 1 ? '' : 's'}`"
      data-testid="session-pull-request-more"
      @click="toggleMenu"
    >
      <Badge variant="neutral" title="More linked pull requests">+{{ others.length }}</Badge>
    </button>
    <PullRequestMenu
      :visible="menuOpen"
      :position="menuPosition"
      :pull-requests="others"
      @select="select"
      @dismiss="menuOpen = false"
    />
  </span>
</template>

<style scoped>
.pr-chips {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.pr-chip {
  display: inline-flex;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  cursor: pointer;
}

.pr-chip :deep(.badge) {
  white-space: nowrap;
  transition: box-shadow var(--duration-fast) var(--ease-out);
}

.pr-chip:hover :deep(.badge) {
  box-shadow: inset 0 0 0 1px currentColor;
}

.pr-chip__icon {
  flex-shrink: 0;
}

.pr-chip__number {
  font-variant-numeric: tabular-nums;
}
</style>
