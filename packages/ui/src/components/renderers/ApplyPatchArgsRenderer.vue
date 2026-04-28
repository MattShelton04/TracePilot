<script setup lang="ts">
/**
 * ApplyPatchArgsRenderer — shows raw apply_patch string arguments before the
 * tool has a persisted result.
 */
import type { TurnToolCall } from "@tracepilot/types";
import ApplyPatchRenderer from "./ApplyPatchRenderer.vue";

defineProps<{
  args: Record<string, unknown>;
  tc: TurnToolCall;
}>();
</script>

<template>
  <ApplyPatchRenderer :content="''" :args="args" :tc="tc" />
</template>
