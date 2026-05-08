<script setup lang="ts">
/**
 * ReplayTimelinePane — scrollable conversation pane for SessionReplayView.
 *
 * Owns the `.replay-conversation` rendering surface (model-switch banners,
 * step content, future-step skeletons) plus the auto-scroll watch that pins
 * the active step into view as the controller advances. DOM wrapper chain,
 * class names, and `data-step` attributes are preserved verbatim from the
 * pre-extraction parent so existing selectors and visual styling remain
 * identical.
 */

import type { ConversationTurn, ReplayStep } from "@tracepilot/types";
import { nextTick, ref, watch } from "vue";
import ModelSwitchBanner from "@/components/replay/ModelSwitchBanner.vue";
import ReplayStepContent from "@/components/replay/ReplayStepContent.vue";

const props = defineProps<{
  visibleSteps: ReplayStep[];
  turnsByIndex: Map<number, ConversationTurn>;
  allTurns: ConversationTurn[];
  currentStep: number;
  fullResults: Map<string, string>;
  loadingResults: Set<string>;
  failedResults: Set<string>;
  isRichEnabled: (toolName: string) => boolean;
}>();

const emit = defineEmits<{
  "load-full-result": [id: string];
  "retry-full-result": [id: string];
}>();

const conversationRef = ref<HTMLElement | null>(null);

watch(
  () => props.currentStep,
  async () => {
    await nextTick();
    if (!conversationRef.value) return;
    const stepEl = conversationRef.value.querySelector(`[data-step="${props.currentStep}"]`);
    if (stepEl) {
      stepEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  },
);
</script>

<template>
  <div ref="conversationRef" class="replay-conversation">
    <template v-for="step in visibleSteps" :key="step.index">
      <ModelSwitchBanner
        v-if="step.modelSwitchFrom && step.model"
        :previous-model="step.modelSwitchFrom"
        :new-model="step.model"
      />

      <div :data-step="step.index">
        <ReplayStepContent
          v-if="turnsByIndex.get(step.turnIndex)"
          :step="step"
          :turn="turnsByIndex.get(step.turnIndex)!"
          :all-turns="allTurns"
          :is-current="step.index === currentStep"
          :is-past="step.index < currentStep"
          :is-future="step.index > currentStep"
          :full-results="fullResults"
          :loading-results="loadingResults"
          :failed-results="failedResults"
          :is-rich-enabled="isRichEnabled"
          @load-full-result="emit('load-full-result', $event)"
          @retry-full-result="emit('retry-full-result', $event)"
        />

        <div
          v-if="step.index > currentStep"
          class="future-skeleton"
          :style="{ opacity: Math.max(0.08, 0.3 - (step.index - currentStep) * 0.05) }"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.replay-conversation {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 300px);
  overflow-y: auto;
  padding-right: 8px;
  scroll-behavior: smooth;
}
.replay-conversation::-webkit-scrollbar { width: 6px; }
.replay-conversation::-webkit-scrollbar-track { background: transparent; }
.replay-conversation::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }

.future-skeleton {
  height: 60px;
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    var(--canvas-subtle) 25%,
    var(--canvas-inset) 50%,
    var(--canvas-subtle) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 2s infinite;
  border: 1px solid var(--border-muted);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .future-skeleton { animation: none; }
}
</style>
