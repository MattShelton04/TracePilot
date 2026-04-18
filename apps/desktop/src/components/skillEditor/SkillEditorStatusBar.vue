<script setup lang="ts">
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
</script>

<template>
  <div class="editor-info-bar">
    <div class="info-group">
      <span class="info-item">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/></svg>
        {{ ctx.store.selectedSkill!.directory }}/SKILL.md
      </span>
      <span class="info-item">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>
        {{ ctx.lastSavedDisplay }}
      </span>
    </div>
    <div class="info-group">
      <span class="info-item">UTF-8</span>
      <span class="info-item">{{ ctx.totalLineCount }} lines</span>
      <span class="info-item">{{ ctx.byteCount.toLocaleString() }} bytes</span>
    </div>
  </div>
</template>
