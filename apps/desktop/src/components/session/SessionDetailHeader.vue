<script setup lang="ts">
/** SessionDetailHeader — the session's title, live indicator and identity badges. */
import {
  isNonCopilotSource,
  modelDisplayName,
  type SessionDetail,
  type SessionSource,
} from "@tracepilot/types";
import { Badge, projectLabelFromCwd } from "@tracepilot/ui";
import { Folder } from "lucide-vue-next";
import { computed } from "vue";
import { effortLabel, sessionEffort, sessionModel } from "@/utils/sessionModel";

const props = defineProps<{
  detail: SessionDetail;
  source: SessionSource;
  sourceName: string;
  /** The session's process is running. */
  active: boolean;
  /** The running session is waiting for input. */
  waiting: boolean;
  liveBadge: { label: string; title: string };
}>();

const currentModel = computed(() => sessionModel(props.detail) ?? "");
const currentEffort = computed(() => sessionEffort(props.detail));
// A session without a repository is identified by its working directory, as on its list card.
const projectLabel = computed(() =>
  props.detail.repository ? null : projectLabelFromCwd(props.detail.cwd),
);
</script>

<template>
  <h1 class="detail-title">
    <Transition name="active-indicator">
      <span v-if="active" class="active-indicator-group">
        <span class="active-dot" :class="{ 'active-dot--waiting': waiting }" :title="liveBadge.title" />
      </span>
    </Transition>
    {{ detail.summary || 'Untitled Session' }}
    <Transition name="active-indicator">
      <span v-if="active" class="active-indicator-group">
        <Badge :variant="waiting ? 'warning' : 'success'" class="active-badge-inline" :title="liveBadge.title">
          ● {{ liveBadge.label }}
        </Badge>
      </span>
    </Transition>
  </h1>
  <div class="detail-badges">
    <Badge :variant="isNonCopilotSource(source) ? 'claude' : 'copilot'" title="Session source">{{ sourceName }}</Badge>
    <Badge v-if="detail.repository" variant="accent">{{ detail.repository }}</Badge>
    <Badge
      v-else-if="projectLabel"
      variant="neutral"
      :title="detail.cwd ?? undefined"
      data-testid="session-project-chip"
    ><Folder :size="12" aria-hidden="true" class="project-chip__icon" />{{ projectLabel }}</Badge>
    <Badge v-if="detail.branch" variant="success">{{ detail.branch }}</Badge>
    <Badge v-if="currentModel" variant="done" :title="currentModel">{{ modelDisplayName(currentModel, source) }}</Badge>
    <Badge v-if="currentEffort" variant="neutral" title="Main agent reasoning effort">{{ effortLabel(currentEffort) }}</Badge>
    <Badge v-if="detail.hostType || !isNonCopilotSource(source)" variant="neutral">{{ detail.hostType || 'cli' }}</Badge>
  </div>
</template>

<style scoped>
.detail-title {
  font-size: 1.375rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.3;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.active-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--success-fg);
  flex-shrink: 0;
  margin-left: 2px;
  animation: pulse-active 2s ease-in-out infinite;
  overflow: visible;
  position: relative;
}

.active-dot--waiting {
  background: var(--warning-fg);
}

@keyframes pulse-active {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.85); }
}

.active-badge-inline {
  font-size: 0.6875rem;
  flex-shrink: 0;
}

.active-indicator-group {
  display: inline-flex;
  align-items: center;
}
.active-indicator-enter-active,
.active-indicator-leave-active {
  transition: opacity 0.4s ease, transform 0.4s ease;
}
.active-indicator-enter-from {
  opacity: 0;
  transform: scale(0);
}
.active-indicator-leave-to {
  opacity: 0;
  transform: scale(0);
}

.detail-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
  min-width: 0;
}

.project-chip__icon {
  flex-shrink: 0;
}
</style>
