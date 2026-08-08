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
            :readonly="ctx.isReadOnly"
            spellcheck="false"
            @input="ctx.onNameInput"
          />
        </div>
        <div class="field-group">
          <label class="field-label">Description</label>
          <textarea
            class="field-textarea"
            rows="2"
            :value="ctx.previewFrontmatter.description"
            :readonly="ctx.isReadOnly"
            @input="ctx.onDescInput"
          />
          <div class="field-footer">
            <span />
            <span class="char-count" :class="ctx.descCharClass">
              {{ ctx.descCharCount }} / 1024
            </span>
          </div>
        </div>
        <details class="frontmatter-advanced">
          <summary>
            <span>Invocation &amp; tool access</span>
            <span class="frontmatter-advanced__hint">Optional</span>
          </summary>
          <div class="frontmatter-advanced__body">
            <div class="field-group">
              <label class="field-label">Argument hint</label>
              <input
                type="text"
                class="field-input field-input--mono"
                :value="ctx.previewFrontmatter['argument-hint'] ?? ''"
                :readonly="ctx.isReadOnly"
                placeholder="e.g. [issue-number]"
                @input="ctx.onFrontmatterTextInput('argument-hint', $event)"
              />
              <div class="field-footer">Shown beside the skill when it expects arguments.</div>
            </div>
            <div class="field-group">
              <label class="field-label">Allowed tools</label>
              <input
                type="text"
                class="field-input field-input--mono"
                :value="Array.isArray(ctx.previewFrontmatter['allowed-tools']) ? ctx.previewFrontmatter['allowed-tools'].join(', ') : (ctx.previewFrontmatter['allowed-tools'] ?? '')"
                :readonly="ctx.isReadOnly"
                placeholder="e.g. Bash(git:*)"
                @input="ctx.onFrontmatterTextInput('allowed-tools', $event)"
              />
              <div class="field-footer">
                These tools can run without another approval prompt. Only list tools you trust.
              </div>
            </div>
            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.previewFrontmatter['user-invocable'] !== false"
                :disabled="ctx.isReadOnly"
                @change="ctx.onFrontmatterBooleanInput('user-invocable', $event)"
              />
              <span>
                <strong>Allow manual use</strong>
                <small>Lets you run this skill explicitly with its slash command.</small>
              </span>
            </label>
            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.previewFrontmatter['disable-model-invocation'] !== true"
                :disabled="ctx.isReadOnly"
                @change="ctx.onAutomaticInvocationInput"
              />
              <span>
                <strong>Allow automatic use</strong>
                <small>Lets Copilot choose this skill when your request matches its description.</small>
              </span>
            </label>
            <details class="raw-frontmatter">
              <summary>View raw YAML</summary>
              <pre class="field-input field-input--mono">{{ ctx.rawFrontmatter }}</pre>
            </details>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
