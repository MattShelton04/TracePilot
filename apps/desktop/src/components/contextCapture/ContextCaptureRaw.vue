<script setup lang="ts">
import { ActionButton, useConfirmDialog, useToast } from "@tracepilot/ui";

const props = defineProps<{ rawBody: string; sha256: string }>();
const { confirm } = useConfirmDialog();
const toast = useToast();

async function copyRaw() {
  const { confirmed } = await confirm({
    title: "Copy sensitive request JSON?",
    message:
      "The exact payload may contain source code, prompts, tool results, attachment data, and secrets. Clipboard managers may retain it.",
    confirmLabel: "Copy exact JSON",
  });
  if (!confirmed) return;
  await navigator.clipboard.writeText(props.rawBody);
  toast.success("Exact request JSON copied");
}
</script>

<template>
  <div class="capture-raw">
    <div><code>SHA-256 {{ sha256 }}</code><ActionButton size="sm" @click="copyRaw">Copy raw JSON…</ActionButton></div>
    <pre>{{ rawBody }}</pre>
  </div>
</template>

<style scoped>
.capture-raw > div { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
code { color: var(--text-tertiary); overflow-wrap: anywhere; }
pre { white-space: pre; overflow: auto; max-height: 65vh; padding: 14px; background: var(--canvas-inset); border-radius: var(--radius-sm); font-size: 12px; }
</style>
