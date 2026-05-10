<!--
  Wrapper that renders user-supplied text and quarantines any emoji
  codepoint inside <span class="ucem">…</span> so chrome typography keeps a
  consistent baseline.
  See design-system/pages/00-globals.md §G1 (User-supplied emoji).
-->
<script setup lang="ts">
import { computed } from "vue";

export interface UserContentEmojiProps {
  /** Raw user text. Emoji codepoints are wrapped in `.ucem`. */
  text: string;
  /** When true, render nothing if text contains no emoji. */
  emojiOnly?: boolean;
}

const props = withDefaults(defineProps<UserContentEmojiProps>(), {
  emojiOnly: false,
});

const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;

const segments = computed<Array<{ text: string; emoji: boolean }>>(() => {
  const out: Array<{ text: string; emoji: boolean }> = [];
  let last = 0;
  const src = props.text ?? "";
  for (const m of src.matchAll(PICTOGRAPHIC)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: src.slice(last, idx), emoji: false });
    out.push({ text: m[0], emoji: true });
    last = idx + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), emoji: false });
  if (props.emojiOnly) return out.filter((s) => s.emoji);
  return out;
});
</script>

<template>
  <span data-tp-component="UserContentEmoji" class="uce">
    <template v-for="(seg, i) in segments" :key="i">
      <span v-if="seg.emoji" class="ucem" aria-hidden="true">{{ seg.text }}</span>
      <template v-else>{{ seg.text }}</template>
    </template>
  </span>
</template>

<style scoped>
.uce {
  font-family: var(--font-family);
}
.ucem {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  margin: 0 1px;
  font-family: var(--font-family);
  font-size: 0.95em;
  line-height: 1;
  outline: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  filter: saturate(0.85);
  vertical-align: baseline;
}
</style>
