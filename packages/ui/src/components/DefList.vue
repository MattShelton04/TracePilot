<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; value: string | number }>;
}>();
</script>

<template>
  <dl class="def-list">
    <template v-for="item in items" :key="item.label">
      <dt>{{ item.label }}</dt>
      <dd>{{ item.value }}</dd>
    </template>
  </dl>
</template>
