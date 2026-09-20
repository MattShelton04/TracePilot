<script setup lang="ts">
/** Shared identity, click surface and layout for definition manager cards. */
withDefaults(
  defineProps<{
    name: string;
    description?: string | null;
    displayName?: string | null;
    openLabel: string;
    interactive?: boolean;
    muted?: boolean;
    accent?: string;
  }>(),
  { interactive: true },
);
defineEmits<{ open: [] }>();
</script>

<template>
  <article class="definition-card" :class="{ 'definition-card--interactive': interactive, 'definition-card--muted': muted }" :style="{ '--definition-accent': accent }">
    <div class="definition-card__accent" />
    <div class="definition-card__top">
      <div class="definition-card__icon"><slot name="icon" /></div>
      <div class="definition-card__info">
        <div class="definition-card__name-row">
          <button v-if="interactive" type="button" class="definition-card__name definition-card__open" :aria-label="openLabel" :title="name" @click="$emit('open')">{{ name }}</button>
          <span v-else class="definition-card__name" :title="name">{{ name }}</span>
          <span v-if="displayName && displayName !== name" class="definition-card__display" :title="displayName">{{ displayName }}</span>
        </div>
        <p class="definition-card__desc" :title="description || undefined">{{ description || "No description" }}</p>
      </div>
    </div>
    <div v-if="$slots.badges" class="definition-card__badges"><slot name="badges" /></div>
    <slot />
    <div v-if="$slots.footer" class="definition-card__footer"><slot name="footer" /></div>
  </article>
</template>

<style scoped>
.definition-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 16px;
  border-radius: var(--radius-lg);
  background: var(--canvas-subtle);
  background-image: var(--gradient-card);
  border: 1px solid var(--border-default);
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
}
.definition-card--interactive:hover {
  border-color: var(--border-accent, var(--accent-fg));
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.definition-card--muted { opacity: 0.7; }
.definition-card:has(.definition-card__open:focus-visible) {
  outline: 2px solid var(--accent-fg);
  outline-offset: 2px;
}
.definition-card__accent {
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--definition-accent, var(--gradient-accent, var(--accent-emphasis)));
  opacity: 0;
  transition: opacity 0.2s ease;
}
.definition-card--interactive:hover .definition-card__accent { opacity: 1; }
.definition-card__top {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.definition-card__icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--definition-accent, var(--accent-emphasis)) 12%, transparent);
  color: var(--definition-accent, var(--accent-fg));
  line-height: 0;
}
.definition-card__info { flex: 1; min-width: 0; }
.definition-card__name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
  min-width: 0;
}
.definition-card__name {
  min-width: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.definition-card__open {
  padding: 0;
  border: 0;
  background: none;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
/* Sibling controls in the badges/footer remain outside the title button. */
.definition-card__open::after { content: ""; position: absolute; inset: 0; }
.definition-card--interactive:hover .definition-card__name { color: var(--accent-fg); }
.definition-card__display {
  min-width: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.definition-card__desc {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.definition-card__badges {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.definition-card__footer {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-muted, var(--border-default));
}
@media (prefers-reduced-motion: reduce) {
  .definition-card { transition: none; }
  .definition-card--interactive:hover { transform: none; }
}
</style>
