<script setup lang="ts">
/**
 * PullRequestMenu — the header's list of a session's other linked pull
 * requests, anchored under the "+N" chip. Teleported to <body>; the parent
 * owns visibility and the anchor, and opens the one chosen.
 */
import {
  pullRequestSlug,
  pullRequestStateLabel,
  pullRequestTone,
  type SessionPullRequest,
  sessionPullRequestState,
  sessionPullRequestTitle,
} from "@tracepilot/types";
import { pullRequestIcon } from "@tracepilot/ui";
import { ref } from "vue";
import { useContextMenu } from "@/composables/useContextMenu";
import { pullRequestTooltip } from "@/utils/pullRequests";

const props = defineProps<{
  visible: boolean;
  position: { x: number; y: number };
  pullRequests: SessionPullRequest[];
}>();

const emit = defineEmits<{
  select: [pr: SessionPullRequest];
  dismiss: [];
}>();

const menuRef = ref<HTMLElement | null>(null);
const { placement, onKeydown } = useContextMenu({
  active: () => props.visible,
  panel: menuRef,
  position: () => props.position,
  dismiss: () => emit("dismiss"),
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="menuRef"
      class="pr-menu"
      role="menu"
      aria-label="Other linked pull requests"
      tabindex="-1"
      :style="{ left: `${placement.x}px`, top: `${placement.y}px` }"
      data-testid="pull-request-menu"
      @click.stop
      @keydown="onKeydown"
    >
      <button
        v-for="pr in pullRequests"
        :key="pr.url"
        type="button"
        role="menuitem"
        tabindex="-1"
        class="pr-menu__item"
        :title="pullRequestTooltip(pr)"
        @click="emit('select', pr)"
      >
        <component
          :is="pullRequestIcon(sessionPullRequestState(pr))"
          :size="14"
          aria-hidden="true"
          class="pr-menu__icon"
          :class="`pr-menu__icon--${pullRequestTone(sessionPullRequestState(pr))}`"
        />
        <span class="pr-menu__slug">{{ pullRequestSlug(pr) }}</span>
        <span v-if="sessionPullRequestTitle(pr)" class="pr-menu__title">{{ sessionPullRequestTitle(pr) }}</span>
        <span v-if="pullRequestStateLabel(sessionPullRequestState(pr))" class="pr-menu__state">
          {{ pullRequestStateLabel(sessionPullRequestState(pr)) }}
        </span>
      </button>
    </div>
    <div v-if="visible" class="pr-menu-backdrop" @click="emit('dismiss')" @contextmenu.prevent="emit('dismiss')" />
  </Teleport>
</template>

<style scoped>
.pr-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-overlay);
}

.pr-menu {
  position: fixed;
  z-index: var(--z-modal);
  width: max-content;
  min-width: min(240px, calc(100vw - 16px));
  max-width: min(420px, calc(100vw - 16px));
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: var(--canvas-overlay);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: 4px 0;
}

.pr-menu__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  font-size: 0.75rem;
  color: var(--text-primary);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background var(--duration-fast) var(--ease-out);
}

.pr-menu__item:hover {
  background: var(--canvas-subtle);
}

.pr-menu__item:focus-visible {
  outline: 2px solid var(--accent-fg);
  outline-offset: -2px;
  background: var(--canvas-subtle);
}

.pr-menu__icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}
.pr-menu__icon--success {
  color: var(--success-fg);
}
.pr-menu__icon--done {
  color: var(--done-fg);
}
.pr-menu__icon--danger {
  color: var(--danger-fg);
}

.pr-menu__slug {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.pr-menu__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
}

.pr-menu__state {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--text-tertiary);
}
</style>
