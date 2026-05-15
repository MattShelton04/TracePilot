<script setup lang="ts">
import type { ExportPreviewResult } from "@tracepilot/types";
import { Badge, EmptyState, formatBytes, MarkdownContent, useToast } from "@tracepilot/ui";
import { computed, ref } from "vue";
import type { ExportTabFormat } from "@/composables/useExportConfig";
import { openExternal } from "@/utils/openExternal";

type PreviewView = "raw" | "rendered";

const props = defineProps<{
  format: ExportTabFormat;
  preview: ExportPreviewResult | null;
  loading: boolean;
  error: string | null;
  hasSelectedSession: boolean;
}>();

const { success: toastSuccess } = useToast();

const previewView = ref<PreviewView>("raw");

const canRenderPreview = computed(() => props.format === "markdown");

const formattedPreviewContent = computed(() => {
  if (!props.preview?.content) return "";
  if (props.format === "json") {
    try {
      return JSON.stringify(JSON.parse(props.preview.content), null, 2);
    } catch {
      return props.preview.content;
    }
  }
  return props.preview.content;
});

function copyToClipboard() {
  if (props.preview?.content) {
    navigator.clipboard.writeText(props.preview.content);
    toastSuccess("Copied to clipboard");
  }
}
</script>

<template>
  <div class="preview-col">
    <div class="preview-panel">
      <!-- Preview Header -->
      <div class="preview-header">
        <h3 class="config-section-title" style="margin: 0">Preview</h3>
        <div class="preview-header-right">
          <Badge variant="accent">{{ format.toUpperCase() }}</Badge>
          <div class="view-toggle">
            <button
              class="view-toggle-btn"
              :class="{ active: previewView === 'raw' }"
              @click="previewView = 'raw'"
            >
              Raw
            </button>
            <button
              class="view-toggle-btn"
              :class="{ active: previewView === 'rendered', disabled: !canRenderPreview }"
              :disabled="!canRenderPreview"
              :title="canRenderPreview ? 'Rendered preview' : 'Rendered view is only available for Markdown'"
              @click="canRenderPreview && (previewView = 'rendered')"
            >
              Rendered
            </button>
          </div>
        </div>
      </div>

      <!-- Preview Body -->
      <div class="preview-body">
        <div v-if="!hasSelectedSession" class="preview-empty">
          <EmptyState description="Select a session to preview the export" size="sm">
            <template #icon>📤</template>
          </EmptyState>
        </div>
        <div v-else-if="loading" class="preview-loading">
          <span class="spinner" /> Generating preview…
        </div>
        <div v-else-if="error" class="preview-error">
          <EmptyState :description="error" size="sm">
            <template #icon>⚠️</template>
          </EmptyState>
        </div>
        <div v-else-if="preview">
          <pre v-if="previewView === 'raw'" class="preview-code"><code>{{ formattedPreviewContent }}</code></pre>
          <MarkdownContent
            v-else-if="canRenderPreview"
            :content="preview.content"
            :render="true"
            @open-external="openExternal"
          />
          <pre v-else class="preview-code"><code>{{ formattedPreviewContent }}</code></pre>
        </div>
      </div>

      <!-- Preview Footer -->
      <div v-if="preview" class="preview-footer">
        <div class="preview-footer-left">
          <span>{{ preview.sectionCount }} section{{ preview.sectionCount !== 1 ? 's' : '' }}</span>
          <span>·</span>
          <span>~{{ formatBytes(preview.estimatedSizeBytes) }}</span>
        </div>
        <button class="link-btn" @click="copyToClipboard">
          Copy to Clipboard
        </button>
      </div>
    </div>
  </div>
</template>
