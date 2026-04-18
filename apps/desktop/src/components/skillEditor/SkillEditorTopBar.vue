<script setup lang="ts">
import SkillScopeBadge from "@/components/skills/SkillScopeBadge.vue";
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
</script>

<template>
  <header class="editor-topbar">
    <button class="topbar-back" @click="ctx.goBack">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12L6 8l4-4"/></svg>
      Back to Skills
    </button>
    <div class="topbar-divider" />
    <div v-if="ctx.store.selectedSkill" class="topbar-skill-name">
      <span class="skill-icon-sm">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l3 2"/></svg>
      </span>
      {{ ctx.store.selectedSkill.frontmatter.name || 'Skill' }}
    </div>
    <div v-if="ctx.store.selectedSkill" class="topbar-meta">
      <SkillScopeBadge :scope="ctx.store.selectedSkill.scope" />
      <span v-if="ctx.editorDirty" class="status-modified">Modified</span>
    </div>
    <div class="topbar-actions">
      <span class="kbd-hint">
        <span class="kbd">Ctrl</span>+<span class="kbd">S</span>
      </span>
      <button class="btn-ghost" :disabled="!ctx.editorDirty" @click="ctx.handleDiscard">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l12 12M14 2L2 14"/></svg>
        Discard
      </button>
      <button class="btn-primary" :disabled="!ctx.editorDirty || ctx.saving" @click="ctx.handleSave">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V5.5L12 2z"/><path d="M10 2v4H6"/><path d="M6 10h4"/></svg>
        {{ ctx.saving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </header>
</template>
