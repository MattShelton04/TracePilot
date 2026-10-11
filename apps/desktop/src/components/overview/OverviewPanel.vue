<!--
  @slots
    icon    — leading icon in the header
    aside   — right side of the header (time range, status)
    default — panel body
  A titled panel for the session Overview's sections.
-->
<script setup lang="ts">
defineProps<{
  title: string;
  /** Drop the body padding for content that draws its own rows. */
  flush?: boolean;
}>();
</script>

<template>
  <section class="overview-panel">
    <header class="overview-panel__header">
      <span v-if="$slots.icon" class="overview-panel__icon"><slot name="icon" /></span>
      <h3 class="overview-panel__title">{{ title }}</h3>
      <div v-if="$slots.aside" class="overview-panel__aside"><slot name="aside" /></div>
    </header>
    <div class="overview-panel__body" :class="{ 'overview-panel__body--flush': flush }">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.overview-panel {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  min-width: 0;
  overflow: hidden;
}

.overview-panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.overview-panel__icon {
  display: inline-flex;
  color: var(--text-tertiary);
}

.overview-panel__title {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.overview-panel__aside {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

.overview-panel__body {
  padding: 14px 16px;
}

.overview-panel__body--flush {
  padding: 0;
}
</style>
