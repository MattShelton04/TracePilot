<script setup lang="ts">
defineProps<{
  /** `slot` names a scoped slot that renders the value instead of plain text. */
  items: Array<{ label: string; value: string | number; slot?: string }>;
}>();
</script>

<template>
  <dl class="def-list">
    <template v-for="item in items" :key="item.label">
      <dt>{{ item.label }}</dt>
      <dd v-if="item.slot"><slot :name="item.slot" :item="item" /></dd>
      <dd v-else :title="String(item.value)">{{ item.value }}</dd>
    </template>
  </dl>
</template>
