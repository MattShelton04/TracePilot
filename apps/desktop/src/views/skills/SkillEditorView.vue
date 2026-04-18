<script setup lang="ts">
import { provide } from "vue";
import SkillAssetPreviewModal from "@/components/skillEditor/SkillAssetPreviewModal.vue";
import SkillEditorMarkdownEditor from "@/components/skillEditor/SkillEditorMarkdownEditor.vue";
import SkillEditorMetadataForm from "@/components/skillEditor/SkillEditorMetadataForm.vue";
import SkillEditorPreviewPane from "@/components/skillEditor/SkillEditorPreviewPane.vue";
import SkillEditorStatusBar from "@/components/skillEditor/SkillEditorStatusBar.vue";
import SkillEditorTopBar from "@/components/skillEditor/SkillEditorTopBar.vue";
import { SkillEditorKey, useSkillEditor } from "@/composables/useSkillEditor";
import "@/styles/features/skill-editor.css";

const ctx = useSkillEditor();
provide(SkillEditorKey, ctx);
</script>

<template>
  <div class="skill-editor-feature">
    <div class="editor-shell">
      <SkillEditorTopBar />

      <!-- Error -->
      <div v-if="ctx.store.error" class="error-bar">{{ ctx.store.error }}</div>

      <!-- Loading -->
      <div v-if="!ctx.store.selectedSkill && !ctx.store.error" class="state-message">
        Loading skill…
      </div>

      <!-- Editor Body -->
      <template v-if="ctx.store.selectedSkill">
        <div
          :ref="(el) => (ctx.containerRef = el as HTMLElement | null)"
          class="editor-body"
          :class="{ 'is-dragging': ctx.dragging }"
          :style="{ gridTemplateColumns: `${ctx.leftWidth}% 5px 1fr` }"
        >
          <div class="panel panel-left">
            <div class="panel-header">
              <span class="panel-header-title">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V3a1 1 0 00-1-1z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>
                Editor
              </span>
              <span class="panel-header-filename">SKILL.md</span>
            </div>

            <div class="panel-scroll">
              <SkillEditorMetadataForm />
              <SkillEditorMarkdownEditor />
            </div>
          </div>

          <div
            class="resize-handle"
            :class="{ active: ctx.dragging }"
            @mousedown="ctx.onMouseDown"
          />

          <SkillEditorPreviewPane />
        </div>

        <SkillEditorStatusBar />
      </template>

      <SkillAssetPreviewModal />
    </div>
  </div>
</template>
