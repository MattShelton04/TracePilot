<!--
  @slots default — title content
  Semantic typography primitive. Caps title sizes at text.h1 (no 36/48px hero
  in chrome). See design-system/pages/02-primitives.md §Heading.
-->
<script setup lang="ts">
import { computed } from "vue";

export interface HeadingProps {
  /** Visual size: 1=text.h1 (20/28), 2=text.h2 (16/22), 3=text.h3 (14/20), 4=text.body-strong (13/18). */
  level: 1 | 2 | 3 | 4;
  /** Semantic HTML tag override. Defaults to `h${level}` (h4 → h4). */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  /** Font weight. Default 600. */
  weight?: 500 | 600 | 700;
  /** Single-line ellipsis. */
  truncate?: boolean;
  /** Use --font-mono (for IDs as titles — rare). */
  mono?: boolean;
}

const props = withDefaults(defineProps<HeadingProps>(), {
  weight: 600,
  truncate: false,
  mono: false,
});

const tag = computed<string>(() => props.as ?? `h${props.level}`);
</script>

<template>
  <component
    :is="tag"
    data-tp-component="Heading"
    class="heading"
    :class="[
      `heading--${level}`,
      `heading--w${weight}`,
      { 'heading--truncate': truncate, 'heading--mono': mono },
    ]"
  >
    <slot />
  </component>
</template>

<style scoped>
.heading {
  margin: 0;
  color: var(--text-primary);
  font-family: var(--font-family);
  letter-spacing: -0.01em;
}
.heading--1 { font-size: 20px; line-height: 28px; }
.heading--2 { font-size: 16px; line-height: 22px; }
.heading--3 { font-size: 14px; line-height: 20px; }
.heading--4 { font-size: 13px; line-height: 18px; }

.heading--w500 { font-weight: 500; }
.heading--w600 { font-weight: 600; }
.heading--w700 { font-weight: 700; }

.heading--mono {
  font-family: var(--font-mono);
  font-feature-settings: "tnum" 1;
  letter-spacing: 0;
}

.heading--truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
