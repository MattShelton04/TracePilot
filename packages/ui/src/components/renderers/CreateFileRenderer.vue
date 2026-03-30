<script setup lang="ts">
/**
 * CreateFileRenderer — renders the create tool result showing the created file.
 */
import { computed } from "vue";
import CodeBlock from "./CodeBlock.vue";
import RendererShell from "./RendererShell.vue";

const props = defineProps<{
  content: string;
  args: Record<string, unknown>;
  isTruncated?: boolean;
}>();

const emit = defineEmits<{
  "load-full": [];
}>();

const filePath = computed(() =>
  typeof props.args?.path === "string" ? props.args.path : undefined,
);

/** The actual file content from args, falling back to result content. */
const fileContent = computed(() => {
  if (typeof props.args?.file_text === "string") return props.args.file_text;
  return props.content;
});

const lineCount = computed(() => {
  const lines = fileContent.value.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
});
</script>

<template>
  <RendererShell
    :label="filePath ?? 'Create'"
    :copy-content="fileContent"
    :is-truncated="isTruncated"
    @load-full="emit('load-full')"
  >
    <div class="create-file-info">
      <span class="create-file-badge create-file-badge--new">📄 New File</span>
      <span class="create-file-badge">{{ lineCount }} line{{ lineCount !== 1 ? 's' : '' }}</span>
    </div>
    <CodeBlock
      :code="fileContent"
      :file-path="filePath"
      :max-lines="2000"
      :show-language-badge="true"
    />
  </RendererShell>
</template>

<style scoped>
.create-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-muted);
}
.create-file-badge {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}
.create-file-badge--new {
  color: var(--success-fg, #34d399);
  font-weight: 600;
}
</style>
