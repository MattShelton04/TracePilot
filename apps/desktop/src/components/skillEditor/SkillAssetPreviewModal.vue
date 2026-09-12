<script setup lang="ts">
import { useOverlayFocus } from "@tracepilot/ui";
import { ref } from "vue";
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
const panelRef = ref<HTMLElement | null>(null);
useOverlayFocus({
  active: () => Boolean(ctx.viewingAsset),
  panel: panelRef,
  onEscape: ctx.closeAssetPreview,
});
</script>

<template>
  <div v-if="ctx.viewingAsset" class="asset-preview-overlay" @click.self="ctx.closeAssetPreview">
    <div ref="panelRef" class="asset-preview-modal" role="dialog" aria-modal="true" :aria-label="ctx.viewingAsset.name" tabindex="-1">
      <div class="asset-preview-header">
        <span class="asset-preview-title">{{ ctx.viewingAsset.name }}</span>
        <button class="asset-preview-close" aria-label="Close asset preview" @click="ctx.closeAssetPreview">✕</button>
      </div>
      <div class="asset-preview-body">
        <div class="asset-preview-meta">
          <span>Size: {{ ctx.formatSize(ctx.viewingAsset.sizeBytes) }}</span>
          <span>Path: {{ ctx.viewingAsset.path }}</span>
        </div>
        <div v-if="ctx.viewingContent !== null" class="asset-preview-content">
          <pre>{{ ctx.viewingContent }}</pre>
        </div>
        <div v-else class="asset-preview-no-content">
          <p>Unable to read file content</p>
          <p class="asset-preview-hint">The file may be binary or could not be read as text.</p>
        </div>
      </div>
    </div>
  </div>
</template>
