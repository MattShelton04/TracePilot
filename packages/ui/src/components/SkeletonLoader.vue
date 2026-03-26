<script setup lang="ts">
defineProps<{
  variant?: 'text' | 'badge' | 'card';
  count?: number;
}>();
</script>

<template>
  <div :class="variant === 'card' ? 'space-y-4' : 'space-y-2'">
    <template v-if="variant === 'card'">
      <div
        v-for="i in (count || 3)"
        :key="i"
        class="skeleton h-24"
      />
    </template>
    <template v-else-if="variant === 'badge'">
      <div class="flex gap-2">
        <div
          v-for="i in (count || 3)"
          :key="i"
          class="skeleton h-5 w-16 rounded-full"
        />
      </div>
    </template>
    <template v-else>
      <div
        v-for="i in (count || 2)"
        :key="i"
        class="skeleton"
        :class="i === 1 ? 'h-6 w-48' : 'h-4 w-32'"
      />
    </template>
  </div>
</template>
