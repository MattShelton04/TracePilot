<script setup lang="ts">
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();

function setEditorRef(el: Element | null) {
  ctx.editorRef = el as HTMLTextAreaElement | null;
}
function setLineNumbersRef(el: Element | null) {
  ctx.lineNumbersRef = el as HTMLElement | null;
}
</script>

<template>
  <div class="instructions-section">
    <div class="instructions-header">
      <span class="instructions-label">Instructions</span>
      <span class="instructions-hint">Markdown supported</span>
    </div>
    <div class="md-toolbar">
      <button class="md-toolbar-btn" title="Bold" @click="ctx.insertBold">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h5a3 3 0 011.5 5.6A3.5 3.5 0 019.5 14H4V2zm2 5h3a1 1 0 100-2H6v2zm0 2v3h3.5a1.5 1.5 0 000-3H6z"/></svg>
      </button>
      <button class="md-toolbar-btn" title="Italic" @click="ctx.insertItalic">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h6v2h-2.2l-2.6 8H9v2H3v-2h2.2l2.6-8H6V2z"/></svg>
      </button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn md-toolbar-btn--text" title="H1" @click="ctx.insertH1">H1</button>
      <button class="md-toolbar-btn md-toolbar-btn--text-sm" title="H2" @click="ctx.insertH2">H2</button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn" title="Bullet List" @click="ctx.insertBulletList">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm3-11h10v1H5V3zm0 5h10v1H5V8zm0 5h10v1H5v-1z"/></svg>
      </button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn" title="Code" @click="ctx.insertCode">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4L1 8l4 4M11 4l4 4-4 4"/></svg>
      </button>
      <button class="md-toolbar-btn" title="Link" @click="ctx.insertLink">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 004 .5l2-2a3 3 0 00-4.24-4.24l-1.14 1.14"/><path d="M9.5 6.5a3 3 0 00-4-.5l-2 2a3 3 0 004.24 4.24l1.14-1.14"/></svg>
      </button>
    </div>

    <div class="md-editor-wrap">
      <div :ref="setLineNumbersRef as unknown as string" class="line-numbers" aria-hidden="true">
        <span v-for="n in ctx.editorLineNumbers" :key="n" class="ln">{{ n }}</span>
      </div>
      <textarea
        :ref="setEditorRef as unknown as string"
        class="md-textarea"
        :value="ctx.previewBody"
        spellcheck="false"
        @input="ctx.onBodyInput"
        @scroll="ctx.syncScroll"
      />
    </div>
  </div>
</template>
