<script setup lang="ts">
import { ActionButton, FileContentViewer, useConfirmDialog, useToast } from "@tracepilot/ui";
import { Copy } from "lucide-vue-next";
import { ref, watch } from "vue";

const props = defineProps<{ rawBody: string; sha256: string }>();
const { confirm } = useConfirmDialog();
const toast = useToast();
const jsonMode = ref<"tree" | "raw">("tree");

watch(
  () => props.sha256,
  () => {
    jsonMode.value = "tree";
  },
);

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
    <div class="capture-raw__toolbar">
      <div>
        <strong>Immutable request body</strong>
        <code>SHA-256 {{ sha256 }}</code>
      </div>
      <ActionButton size="sm" @click="copyRaw">
        <Copy :size="14" /> Copy raw JSON…
      </ActionButton>
    </div>
    <div class="capture-raw__viewer">
      <FileContentViewer
        file-path="request.json"
        file-type="json"
        :content="rawBody"
        :json-mode="jsonMode"
        :show-copy-content="false"
        @update:json-mode="jsonMode = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.capture-raw {
  overflow: hidden;
  border: 1px solid var(--border-muted);
  border-radius: var(--radius-lg);
  background: var(--canvas-default);
}

.capture-raw__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 64px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.capture-raw__toolbar > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.capture-raw code {
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.capture-raw__viewer {
  display: flex;
  height: min(68vh, 760px);
  min-height: 480px;
  overflow: hidden;
}
</style>
