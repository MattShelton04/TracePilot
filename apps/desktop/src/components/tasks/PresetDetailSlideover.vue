<script setup lang="ts">
import type { TaskPreset } from "@tracepilot/types";
import PresetContextSection from "./presetDetail/PresetContextSection.vue";
import PresetDetailFooter from "./presetDetail/PresetDetailFooter.vue";
import PresetDetailHeader from "./presetDetail/PresetDetailHeader.vue";
import PresetExecutionSection from "./presetDetail/PresetExecutionSection.vue";
import PresetOutputSection from "./presetDetail/PresetOutputSection.vue";
import PresetPromptSection from "./presetDetail/PresetPromptSection.vue";
import { usePresetSections } from "./presetDetail/usePresetSections";

defineProps<{
  preset: TaskPreset | null;
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  run: [preset: TaskPreset];
  duplicate: [preset: TaskPreset];
  edit: [preset: TaskPreset];
  delete: [preset: TaskPreset];
}>();

const { sections, toggleSection } = usePresetSections();
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="preset-backdrop" @click="emit('close')" />
    <Transition name="slideover" appear>
      <div v-if="visible && preset" class="preset-slideover">
        <PresetDetailHeader :preset="preset" @close="emit('close')" />

        <div class="detail-panel__body">
          <PresetPromptSection
            :preset="preset"
            :expanded="sections.prompt"
            @toggle="toggleSection('prompt')"
          />
          <PresetContextSection
            :preset="preset"
            :expanded="sections.context"
            @toggle="toggleSection('context')"
          />
          <PresetOutputSection
            :preset="preset"
            :expanded="sections.output"
            @toggle="toggleSection('output')"
          />
          <PresetExecutionSection
            :preset="preset"
            :expanded="sections.execution"
            @toggle="toggleSection('execution')"
          />
        </div>

        <PresetDetailFooter
          :preset="preset"
          @run="emit('run', $event)"
          @duplicate="emit('duplicate', $event)"
          @edit="emit('edit', $event)"
          @delete="emit('delete', $event)"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style src="./presetDetail/preset-detail.css"></style>
