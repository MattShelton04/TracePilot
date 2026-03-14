<script setup lang="ts">
defineProps<{
  variant?: "text" | "badge" | "card";
  count?: number;
}>();
</script>

<template>
  <div class="animate-pulse" :class="variant === 'card' ? 'space-y-4' : 'space-y-2'">
    <template v-if="variant === 'card'">
      <div
        v-for="i in (count || 3)"
        :key="i"
        class="h-24 rounded-lg bg-[var(--color-border-muted)]"
      />
    </template>
    <template v-else-if="variant === 'badge'">
      <div class="flex gap-2">
        <div
          v-for="i in (count || 3)"
          :key="i"
          class="h-5 w-16 rounded-full bg-[var(--color-border-muted)]"
        />
      </div>
    </template>
    <template v-else>
      <div
        v-for="i in (count || 2)"
        :key="i"
        class="rounded bg-[var(--color-border-muted)]"
        :class="i === 1 ? 'h-6 w-48' : 'h-4 w-32'"
      />
    </template>
  </div>
</template>
