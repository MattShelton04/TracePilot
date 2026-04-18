<script setup lang="ts">
import { useSkillEditorContext } from "@/composables/useSkillEditor";

const ctx = useSkillEditorContext();
</script>

<template>
  <div v-if="ctx.previewFrontmatter" class="frontmatter-section">
    <div class="frontmatter-card">
      <div class="frontmatter-header">
        <span class="frontmatter-label">
          Frontmatter
          <span class="yaml-tag">YAML</span>
        </span>
      </div>
      <div class="frontmatter-body">
        <div class="field-group">
          <label class="field-label">Name</label>
          <input
            type="text"
            class="field-input field-input--mono"
            :value="ctx.previewFrontmatter.name"
            spellcheck="false"
            @input="ctx.onNameInput"
          />
        </div>
        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea
            class="field-textarea"
            rows="3"
            :value="ctx.previewFrontmatter.description"
            @input="ctx.onDescInput"
          />
          <div class="field-footer">
            <span />
            <span class="char-count" :class="ctx.descCharClass">
              {{ ctx.descCharCount }} / 1024
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
