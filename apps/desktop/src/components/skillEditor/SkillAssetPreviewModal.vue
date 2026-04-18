<script setup lang="ts">
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
</script>

<template>
  <div v-if="ctx.viewingAsset" class="asset-preview-overlay" @click.self="ctx.closeAssetPreview">
    <div class="asset-preview-modal">
      <div class="asset-preview-header">
        <span class="asset-preview-title">{{ ctx.viewingAsset.name }}</span>
        <button class="asset-preview-close" @click="ctx.closeAssetPreview">✕</button>
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
