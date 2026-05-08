<script setup lang="ts">
/**
 * ConversationViewSwitcher — segmented control for picking between the chat /
 * compact / timeline conversation views. Pulled out of `ConversationTab.vue`
 * during the B2-D2 decomposition so the parent stays a thin layout.
 */
import { BtnGroup } from "@tracepilot/ui";

export type ConversationViewMode = "chat" | "compact" | "timeline";

interface ViewModeOption {
  value: ConversationViewMode;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: ConversationViewMode;
    availableModes?: ViewModeOption[];
  }>(),
  {
    availableModes: () => [
      { value: "chat", label: "Chat" },
      { value: "compact", label: "Compact" },
      { value: "timeline", label: "Timeline" },
    ],
  },
);

const emit = defineEmits<(e: "update:modelValue", value: ConversationViewMode) => void>();

function onUpdate(value: string) {
  emit("update:modelValue", value as ConversationViewMode);
}

void props;
</script>

<template>
  <div class="flex items-center justify-between mb-4">
    <BtnGroup :model-value="modelValue" :options="availableModes" @update:model-value="onUpdate" />
  </div>
</template>
