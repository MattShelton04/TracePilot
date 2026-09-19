<script setup lang="ts">
/**
 * Line-numbered Markdown textarea with a formatting toolbar, shared by the
 * Skill and Agent editors. Styles come from `definition-editor.css`.
 */
import { computed, ref } from "vue";
import { useMarkdownToolbar } from "@/composables/definitionEditor/markdownToolbar";

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    hint?: string;
    readonly?: boolean;
    /** Hide the Markdown toolbar (e.g. when editing raw YAML). */
    plain?: boolean;
  }>(),
  { hint: "Markdown supported", readonly: false, plain: false },
);

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const textarea = ref<HTMLTextAreaElement | null>(null);
const gutter = ref<HTMLElement | null>(null);
const lineNumbers = computed(() => props.modelValue.split("\n").length);

const { insertBold, insertItalic, insertH1, insertH2, insertBulletList, insertCode, insertLink } =
  useMarkdownToolbar(
    textarea,
    computed(() => props.readonly),
    (body) => emit("update:modelValue", body),
  );

function onInput(event: Event) {
  if (props.readonly) return;
  emit("update:modelValue", (event.target as HTMLTextAreaElement).value);
}

function syncScroll() {
  if (textarea.value && gutter.value) gutter.value.scrollTop = textarea.value.scrollTop;
}
</script>

<template>
  <div class="instructions-section">
    <div class="instructions-header">
      <label :for="id" class="instructions-label">{{ label }}</label>
      <span v-if="hint" class="instructions-hint">{{ hint }}</span>
    </div>
    <div v-if="!plain" class="md-toolbar">
      <button class="md-toolbar-btn" title="Bold" :disabled="readonly" @click="insertBold">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h5a3 3 0 011.5 5.6A3.5 3.5 0 019.5 14H4V2zm2 5h3a1 1 0 100-2H6v2zm0 2v3h3.5a1.5 1.5 0 000-3H6z"/></svg>
      </button>
      <button class="md-toolbar-btn" title="Italic" :disabled="readonly" @click="insertItalic">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h6v2h-2.2l-2.6 8H9v2H3v-2h2.2l2.6-8H6V2z"/></svg>
      </button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn md-toolbar-btn--text" title="H1" :disabled="readonly" @click="insertH1">H1</button>
      <button class="md-toolbar-btn md-toolbar-btn--text-sm" title="H2" :disabled="readonly" @click="insertH2">H2</button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn" title="Bullet List" :disabled="readonly" @click="insertBulletList">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm3-11h10v1H5V3zm0 5h10v1H5V8zm0 5h10v1H5v-1z"/></svg>
      </button>
      <div class="md-toolbar-sep" />
      <button class="md-toolbar-btn" title="Code" :disabled="readonly" @click="insertCode">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4L1 8l4 4M11 4l4 4-4 4"/></svg>
      </button>
      <button class="md-toolbar-btn" title="Link" :disabled="readonly" @click="insertLink">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 004 .5l2-2a3 3 0 00-4.24-4.24l-1.14 1.14"/><path d="M9.5 6.5a3 3 0 00-4-.5l-2 2a3 3 0 004.24 4.24l1.14-1.14"/></svg>
      </button>
    </div>

    <div class="md-editor-wrap">
      <div ref="gutter" class="line-numbers" aria-hidden="true">
        <span v-for="n in lineNumbers" :key="n" class="ln">{{ n }}</span>
      </div>
      <textarea
        :id="id"
        ref="textarea"
        class="md-textarea"
        :value="modelValue"
        :readonly="readonly"
        spellcheck="false"
        @input="onInput"
        @scroll="syncScroll"
      />
    </div>
  </div>
</template>
