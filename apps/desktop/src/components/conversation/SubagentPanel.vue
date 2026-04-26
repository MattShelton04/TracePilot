<script setup lang="ts">
// Host wrapper: slide-out chrome around the shared <SubagentPanel />.
// Owns the slide transition, the scrollable container, the prev/next nav footer
// and the per-session tool-result loader.
import { SubagentPanel, SubagentPanelNav } from "@tracepilot/ui";
import { computed, nextTick, ref, watch } from "vue";
import { fromSubagentFullData } from "@/composables/subagentView";
import type { SubagentFullData } from "@/composables/useCrossTurnSubagents";
import { useSessionDetailContext } from "@/composables/useSessionDetailContext";
import { useToolResultLoader } from "@/composables/useToolResultLoader";
import { usePreferencesStore } from "@/stores/preferences";

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
      <div ref="scrollContainer" class="cv-panel-scroll">
        <SubagentPanel
          :view="view"
          :render-markdown="renderMd"
          :is-rich-rendering-enabled="isRich"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          @close="emit('close')"
          @load-full-result="loadFullResult"
          @retry-full-result="retryFullResult"
          @select-subagent="emit('select-subagent', $event)"
        />
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
