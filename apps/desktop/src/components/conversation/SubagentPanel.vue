<script setup lang="ts">
// Host wrapper: slide-out chrome around the shared <SubagentPanel />.
// Owns the slide transition, the scrollable container, the prev/next nav footer
// and the per-session tool-result loader.
//
// The header is rendered OUTSIDE the scroll container so it (a) stays pinned
// while the body scrolls and (b) spans the full panel width including the
// scrollbar gutter — otherwise the scrollbar track shows a strip of the
// panel background next to the header.

import {
  formatDuration,
  formatLiveDuration,
  getAgentColor,
  getAgentIcon,
  SubagentPanel,
  SubagentPanelHeader,
  SubagentPanelNav,
} from "@tracepilot/ui";
import { computed, nextTick, ref, watch } from "vue";
import { fromSubagentFullData } from "@/composables/subagentView";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";
import SubagentToolRow from "./SubagentToolRow.vue";

const props = defineProps<{
  subagent: SubagentFullData | null;
  isOpen: boolean;
  currentIndex: number;
  totalCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  topOffset: number;
}>();

const emit = defineEmits<{
  close: [];
  prev: [];
  next: [];
  "select-subagent": [toolCallId: string];
}>();

const preferences = usePreferencesStore();
const renderMd = computed(() => preferences.isFeatureEnabled("renderMarkdown"));
const isRich = (toolName: string) => preferences.isRichRenderingEnabled(toolName);

const store = useSessionDetailContext();
const { fullResults, loadingResults, failedResults, loadFullResult, retryFullResult } =
  useToolResultLoader(() => store.sessionId);

const view = computed(() => (props.subagent ? fromSubagentFullData(props.subagent) : null));

const agentColor = computed(() => (view.value ? getAgentColor(view.value.type) : ""));
const agentIcon = computed(() => (view.value ? getAgentIcon(view.value.type) : ""));
const statusText = computed(() => {
  if (!view.value) return "";
  if (view.value.status === "completed") return "Completed";
  if (view.value.status === "failed") return "Failed";
  return "Running";
});
const headerDuration = computed(() => {
  if (!view.value) return "";
  const ms = view.value.durationMs;
  if (view.value.status === "in-progress") return ms ? formatLiveDuration(ms) : "";
  return formatDuration(ms ?? 0);
});

const scrollContainer = ref<HTMLElement | null>(null);
watch(
  () => props.subagent?.agentId,
  () => {
    nextTick(() => scrollContainer.value?.scrollTo({ top: 0 }));
  },
);
</script>

<template>
  <Transition name="cv-panel">
    <div
      v-if="isOpen && view"
      class="cv-panel"
      :style="{ top: `${topOffset}px` }"
      role="dialog"
      aria-label="Subagent detail panel"
      @keydown.esc="emit('close')"
    >
      <SubagentPanelHeader
        :view="view"
        :agent-color="agentColor"
        :agent-icon="agentIcon"
        :header-duration="headerDuration"
        :status-text="statusText"
        @close="emit('close')"
      />
      <div ref="scrollContainer" class="cv-panel-scroll">
        <SubagentPanel
          :view="view"
          :render-markdown="renderMd"
          :is-rich-rendering-enabled="isRich"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          :show-header="false"
          @close="emit('close')"
          @load-full-result="loadFullResult"
          @retry-full-result="retryFullResult"
          @select-subagent="emit('select-subagent', $event)"
        >
          <template #tool="{ item, expanded, fullResult, loadingFullResult, failedFullResult, richEnabled, toggle }">
            <SubagentToolRow
              :tool-call="item.toolCall"
              :expanded="expanded"
              :full-result="fullResult"
              :loading-full-result="loadingFullResult"
              :failed-full-result="failedFullResult"
              :rich-enabled="richEnabled"
              @toggle="toggle"
              @load-full-result="loadFullResult"
              @retry-full-result="retryFullResult"
            />
          </template>
        </SubagentPanel>
      </div>

      <SubagentPanelNav
        :current-index="currentIndex"
        :total-count="totalCount"
        :has-prev="hasPrev"
        :has-next="hasNext"
        @prev="emit('prev')"
        @next="emit('next')"
      />
    </div>
  </Transition>
</template>

<style scoped>
.cv-panel-enter-active,
.cv-panel-leave-active {
  transition: transform 320ms cubic-bezier(0.4, 0, 0.2, 1);
}
.cv-panel-enter-from,
.cv-panel-leave-to {
  transform: translateX(100%);
}

.cv-panel {
  position: fixed;
  right: 0;
  bottom: 0;
  width: 38%;
  min-width: 380px;
  max-width: 650px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  background: var(--canvas-subtle);
  border-left: 1px solid var(--border-default);
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
  outline: none;
}

@media (max-width: 959px) {
  .cv-panel {
    width: 100%;
    min-width: 0;
    max-width: none;
  }
}

.cv-panel-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
