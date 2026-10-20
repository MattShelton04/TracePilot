<script setup lang="ts">
/**
 * Overview: the GitHub pull requests the session is linked to, grouped by
 * what it did (created or updated, merged, reviewed). A group of more than
 * five starts collapsed. Hidden when there are none.
 */
import { useToast } from "@tracepilot/ui";
import { ChevronRight } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import OverviewPanel from "@/components/overview/OverviewPanel.vue";
import PullRequestRow from "@/components/overview/PullRequestRow.vue";
import { useConversationNavigation } from "@/composables/useConversationNavigation";
import { usePullRequestLinks } from "@/composables/usePullRequestLinks";
import { groupPullRequests, turnForEvent } from "@/utils/pullRequests";
import { useOverviewModel } from "./overviewModel";

const { store } = useOverviewModel();
const { canOpen, open, copyLink } = usePullRequestLinks();
const navigateToConversation = useConversationNavigation();
const toast = useToast();

const pullRequests = computed(() => store.pullRequests);
const groups = computed(() => groupPullRequests(pullRequests.value));
const showGroupLabels = computed(() => groups.value.length > 1);

/** Collapsed groups the user opened; a session switch closes them again. */
const expanded = ref(new Set<string>());
watch(
  () => store.sessionId,
  () => {
    expanded.value = new Set();
  },
);

function toggle(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

async function jump(eventIndex: number | null) {
  if (eventIndex == null) return;
  const id = store.sessionId;
  await store.loadTurns();
  if (store.sessionId !== id) return;
  const turn = turnForEvent(store.turns, eventIndex);
  if (!turn) {
    toast.warning("Couldn't find that event in the conversation");
    return;
  }
  navigateToConversation({ turnIndex: turn.turnIndex, eventIndex });
}
</script>

<template>
  <OverviewPanel
    v-if="pullRequests.length"
    title="Pull requests"
    flush
    class="mb-6"
    data-testid="pull-requests-section"
  >
    <template #aside>{{ pullRequests.length }} linked</template>
    <div v-for="group in groups" :key="group.key" class="pr-group" :data-group="group.key">
      <button
        v-if="group.collapsed"
        type="button"
        class="pr-group__toggle"
        :aria-expanded="expanded.has(group.key)"
        @click="toggle(group.key)"
      >
        <ChevronRight
          :size="14"
          aria-hidden="true"
          class="pr-group__chevron"
          :class="{ 'pr-group__chevron--open': expanded.has(group.key) }"
        />
        {{ group.summary }}
      </button>
      <div v-else-if="showGroupLabels" class="pr-group__label">{{ group.label }}</div>
      <ul v-if="!group.collapsed || expanded.has(group.key)" class="pr-group__list">
        <PullRequestRow
          v-for="pr in group.prs"
          :key="pr.url"
          :pr="pr"
          :can-open="canOpen"
          @open="open(pr.url)"
          @copy="copyLink(pr.url)"
          @jump="jump(pr.eventIndex)"
        />
      </ul>
    </div>
  </OverviewPanel>
</template>

<style scoped>
.pr-group + .pr-group {
  border-top: 1px solid var(--border-muted);
}

.pr-group__label,
.pr-group__toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px 16px 0;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--text-tertiary);
}

.pr-group__toggle {
  padding-bottom: 8px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
}

.pr-group__toggle:hover {
  color: var(--text-primary);
}

.pr-group__chevron {
  flex-shrink: 0;
  transition: transform var(--duration-fast) var(--ease-out);
}

.pr-group__chevron--open {
  transform: rotate(90deg);
}

.pr-group__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (prefers-reduced-motion: reduce) {
  .pr-group__chevron {
    transition: none;
  }
}
</style>
