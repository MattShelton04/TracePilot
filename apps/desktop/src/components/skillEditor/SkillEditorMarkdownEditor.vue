<script setup lang="ts">
import MarkdownBodyEditor from "@/components/definitionEditor/MarkdownBodyEditor.vue";
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
</script>

<template>
  <MarkdownBodyEditor
    id="skill-editor-instructions"
    label="Instructions"
    :model-value="ctx.previewBody"
    :readonly="ctx.isReadOnly"
    @update:model-value="ctx.setBody"
  />
</template>
