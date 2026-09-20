<script setup lang="ts">
import { Banner, TabNav, type TabNavItem } from "@tracepilot/ui";
import { computed, provide, ref, useId } from "vue";
import AgentEditorTopBar from "@/components/agentEditor/AgentEditorTopBar.vue";
import AgentEffectiveTab from "@/components/agentEditor/AgentEffectiveTab.vue";
import AgentMetadataForm from "@/components/agentEditor/AgentMetadataForm.vue";
import AgentOverrideDialog from "@/components/agentEditor/AgentOverrideDialog.vue";
import AgentPreviewTab from "@/components/agentEditor/AgentPreviewTab.vue";
import AgentUsageTab from "@/components/agentEditor/AgentUsageTab.vue";
import MarkdownBodyEditor from "@/components/definitionEditor/MarkdownBodyEditor.vue";
import { AgentEditorKey, useAgentEditor } from "@/composables/useAgentEditor";
import "@/styles/features/definition-editor.css";
import "@/styles/features/agent-editor.css";

const ctx = useAgentEditor();
provide(AgentEditorKey, ctx);

const editorPaneId = useId();
const resizeHintId = useId();
const bodyId = useId();
const showOverride = ref(false);

// Local (non-routed) mode: `routeName` is unused but part of the item shape.
const tabs = computed<TabNavItem[]>(() => [
  { name: "preview", routeName: "", label: "Preview" },
  { name: "usage", routeName: "", label: "Usage", count: ctx.usage?.stats.runs || undefined },
  { name: "effective", routeName: "", label: "Effective config" },
]);

const fileLabel = computed(() => {
  const path = ctx.detail?.summary.path ?? "";
  return path.split(/[\\/]/).pop() ?? "";
});
</script>

<template>
  <div class="definition-editor agent-editor">
    <div class="editor-shell">
      <AgentEditorTopBar @override="showOverride = true" />

      <div v-if="ctx.error" role="alert" class="error-bar">{{ ctx.error }}</div>

      <div v-if="ctx.loading && !ctx.detail && !ctx.isSessionOnly" class="state-message">
        Loading agent…
      </div>

      <div
        v-else
        :ref="(el) => (ctx.containerRef = el as HTMLElement | null)"
        class="editor-body"
        :class="{ 'is-dragging': ctx.dragging }"
        :style="{ '--agent-split': `${ctx.leftWidth}%` }"
      >
        <div :id="editorPaneId" class="panel panel-left">
          <div class="panel-header">
            <span class="panel-header-title">
              {{ ctx.isReadOnly ? "Source" : "Editor" }}
            </span>
            <span class="panel-header-filename">{{ fileLabel }}</span>
            <label v-if="ctx.detail" class="raw-toggle">
              <input type="checkbox" :checked="ctx.rawMode" @change="ctx.rawMode = !ctx.rawMode" />
              Raw file
            </label>
          </div>

          <div class="panel-scroll">
            <Banner v-if="ctx.isSessionOnly" tone="info" title="No definition found">
              This agent appears in sessions but no definition file was found — it may have been
              renamed or deleted, come from an <code>--add-dir</code> directory, or belong to a
              plugin that is no longer installed. Its usage is shown on the right.
            </Banner>

            <template v-else-if="ctx.detail">
              <Banner v-if="ctx.readOnlyReason" tone="info" title="Read-only">
                {{ ctx.readOnlyReason }}
                <template v-if="ctx.detail.summary.scope === 'builtin'">
                  Use <strong>Override</strong> to change its model or effort in a way that survives
                  CLI updates.
                </template>
              </Banner>

              <Banner
                v-for="diagnostic in ctx.detail.diagnostics"
                :key="diagnostic.message"
                :tone="diagnostic.severity === 'error' ? 'danger' : 'warning'"
              >
                {{ diagnostic.message }}
              </Banner>

              <MarkdownBodyEditor
                v-if="ctx.rawMode"
                :id="bodyId"
                label="Raw file"
                :model-value="ctx.rawDraft"
                :readonly="ctx.isReadOnly"
                plain
                hint="Saved verbatim — comments and key order are yours to keep"
                @update:model-value="ctx.setRaw"
              />
              <template v-else>
                <AgentMetadataForm />
                <MarkdownBodyEditor
                  :id="bodyId"
                  label="Prompt"
                  :model-value="ctx.body"
                  :readonly="ctx.isReadOnly"
                  @update:model-value="ctx.setBody"
                />
              </template>
            </template>
          </div>
        </div>

        <div
          class="resize-handle"
          :class="{ active: ctx.dragging }"
          role="separator"
          tabindex="0"
          aria-label="Resize editor and detail"
          aria-orientation="vertical"
          :aria-controls="editorPaneId"
          :aria-describedby="resizeHintId"
          :aria-valuemin="ctx.minLeftWidth"
          :aria-valuemax="ctx.maxLeftWidth"
          :aria-valuenow="ctx.leftWidth"
          :aria-valuetext="`${Math.round(ctx.leftWidth)}% editor width`"
          title="Resize with Left/Right arrows. Hold Shift for larger steps. Home/End for limits; Enter to reset."
          @mousedown="ctx.onMouseDown"
          @keydown="ctx.onResizeKeyDown"
        />

        <div class="panel panel-right">
          <div class="panel-header panel-header--tabs">
            <TabNav
              :tabs="tabs"
              :model-value="ctx.activeTab"
              @update:model-value="ctx.activeTab = $event as typeof ctx.activeTab"
            />
          </div>
          <div class="panel-scroll">
            <AgentPreviewTab v-if="ctx.activeTab === 'preview'" />
            <AgentUsageTab v-else-if="ctx.activeTab === 'usage'" />
            <AgentEffectiveTab v-else />
          </div>
        </div>
      </div>

      <span :id="resizeHintId" class="resize-help">
        Use Left and Right arrows to resize. Hold Shift for larger steps. Home and End move to the
        limits. Enter resets the split.
      </span>

      <div class="editor-info-bar">
        <div class="info-group">
          <span v-if="ctx.detail" class="info-item">{{ ctx.detail.summary.path }}</span>
          <span v-if="ctx.detail" class="info-item">{{ ctx.detail.summary.sourceLabel }}</span>
        </div>
        <div class="info-group">
          <span v-if="ctx.lastBackup" class="info-item">Backup: {{ ctx.lastBackup }}</span>
          <span v-if="ctx.errorDiagnostics.length" class="info-item info-item--error">
            {{ ctx.errorDiagnostics.length }} error{{ ctx.errorDiagnostics.length === 1 ? "" : "s" }}
          </span>
          <span v-if="ctx.saveState" class="info-item">{{ ctx.saveState }}</span>
        </div>
      </div>

      <AgentOverrideDialog v-model:visible="showOverride" />
    </div>
  </div>
</template>
