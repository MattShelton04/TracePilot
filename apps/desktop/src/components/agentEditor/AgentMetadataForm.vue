<script setup lang="ts">
/**
 * The definition's frontmatter (or built-in YAML header) as a form. Only
 * fields the user changed are patched on save, so comments, key order and
 * keys TracePilot does not know are preserved.
 */
import { computed } from "vue";
import AgentModelList from "@/components/agentEditor/AgentModelList.vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";

const ctx = useAgentEditorContext();

const EFFORTS = ["low", "medium", "high"] as const;

/** Keep an effort the CLI knows but TracePilot does not in the list. */
const effortOptions = computed(() => {
  const current = ctx.fields?.reasoningEffort;
  const options: string[] = [...EFFORTS];
  if (current && !options.includes(current)) options.push(current);
  return options;
});

const toolsText = computed(() => ctx.fields?.tools?.join(", ") ?? "");

function setTools(value: string) {
  const trimmed = value.trim();
  ctx.patchFields({
    tools:
      trimmed === ""
        ? null
        : trimmed
            .split(",")
            .map((tool) => tool.trim())
            .filter(Boolean),
  });
}

function setText(key: "name" | "displayName" | "description" | "modelPolicy", value: string) {
  ctx.patchFields({ [key]: value.trim() === "" ? null : value });
}
</script>

<template>
  <div v-if="ctx.fields" class="frontmatter-section">
    <div class="frontmatter-card">
      <div class="frontmatter-header">
        <span class="frontmatter-label">
          {{ ctx.detail?.summary.format === "yaml" ? "Definition" : "Frontmatter" }}
          <span class="yaml-tag">YAML</span>
        </span>
      </div>
      <div class="frontmatter-body">
        <div class="field-group">
          <label for="agent-name" class="field-label">Name</label>
          <input
            id="agent-name"
            type="text"
            class="field-input field-input--mono"
            :value="ctx.fields.name ?? ''"
            :readonly="ctx.isReadOnly"
            spellcheck="false"
            :placeholder="ctx.detail?.summary.fileStem"
            @input="setText('name', ($event.target as HTMLInputElement).value)"
          />
          <div class="field-footer">The name the CLI dispatches by; defaults to the file name.</div>
        </div>

        <div class="field-group">
          <label for="agent-description" class="field-label">Description</label>
          <textarea
            id="agent-description"
            class="field-textarea"
            rows="2"
            :value="ctx.fields.description ?? ''"
            :readonly="ctx.isReadOnly"
            @input="setText('description', ($event.target as HTMLTextAreaElement).value)"
          />
          <div class="field-footer">Shown to the model when it chooses an agent.</div>
        </div>

        <AgentModelList
          :models="ctx.fields.models"
          :readonly="ctx.isReadOnly"
          @update="ctx.patchFields({ models: $event })"
        />

        <label class="frontmatter-option">
          <input
            type="checkbox"
            :checked="ctx.fields.modelPolicy === 'required'"
            :disabled="ctx.isReadOnly"
            @change="
              ctx.patchFields({
                modelPolicy: ($event.target as HTMLInputElement).checked ? 'required' : null,
              })
            "
          />
          <span>
            <strong>Require the listed models</strong>
            <small>model-policy: required — fail rather than fall back to another model.</small>
          </span>
        </label>

        <div class="field-group">
          <label for="agent-effort" class="field-label">Reasoning effort</label>
          <select
            id="agent-effort"
            class="field-input"
            :value="ctx.fields.reasoningEffort ?? ''"
            :disabled="ctx.isReadOnly"
            @change="
              ctx.patchFields({
                reasoningEffort: ($event.target as HTMLSelectElement).value || null,
              })
            "
          >
            <option value="">Not set — inherit the session</option>
            <option v-for="effort in effortOptions" :key="effort" :value="effort">{{ effort }}</option>
          </select>
        </div>

        <details class="frontmatter-advanced">
          <summary>
            <span>Context, tools and invocation</span>
            <span class="frontmatter-advanced__hint">Optional</span>
          </summary>
          <div class="frontmatter-advanced__body">
            <div class="field-group">
              <label for="agent-context-tier" class="field-label">Context tier</label>
              <select
                id="agent-context-tier"
                class="field-input"
                :value="ctx.fields.contextTier ?? ''"
                :disabled="ctx.isReadOnly"
                @change="
                  ctx.patchFields({ contextTier: ($event.target as HTMLSelectElement).value || null })
                "
              >
                <option value="">Not set</option>
                <option value="default">default</option>
                <option value="long_context">long_context</option>
              </select>
            </div>

            <div class="field-group">
              <label for="agent-tools" class="field-label">Tools</label>
              <input
                id="agent-tools"
                type="text"
                class="field-input field-input--mono"
                :value="toolsText"
                :readonly="ctx.isReadOnly"
                spellcheck="false"
                placeholder="leave empty for every tool"
                @input="setTools(($event.target as HTMLInputElement).value)"
              />
              <div class="field-footer">
                Comma-separated. An empty value removes the key, which gives the agent every tool.
              </div>
            </div>

            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.fields.includeCustomInstructions === true"
                :disabled="ctx.isReadOnly"
                @change="
                  ctx.patchFields({
                    includeCustomInstructions: ($event.target as HTMLInputElement).checked || null,
                  })
                "
              />
              <span>
                <strong>Include custom instructions</strong>
                <small>Repository instructions are added to this agent's prompt (CLI 1.0.86+).</small>
              </span>
            </label>

            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.fields.deferredToolLoading === true"
                :disabled="ctx.isReadOnly"
                @change="
                  ctx.patchFields({
                    deferredToolLoading: ($event.target as HTMLInputElement).checked || null,
                  })
                "
              />
              <span>
                <strong>Defer tool loading</strong>
                <small>Tool schemas load on demand, which shortens the initial prompt.</small>
              </span>
            </label>

            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.fields.disableModelInvocation === true"
                :disabled="ctx.isReadOnly"
                @change="
                  ctx.patchFields({
                    disableModelInvocation: ($event.target as HTMLInputElement).checked || null,
                  })
                "
              />
              <span>
                <strong>Never invoked automatically</strong>
                <small>Only you can start it, not the model.</small>
              </span>
            </label>

            <label class="frontmatter-option">
              <input
                type="checkbox"
                :checked="ctx.fields.userInvocable !== false"
                :disabled="ctx.isReadOnly"
                @change="
                  ctx.patchFields({
                    userInvocable: ($event.target as HTMLInputElement).checked ? null : false,
                  })
                "
              />
              <span>
                <strong>You can invoke it</strong>
                <small>Listed by /agents and accepted by --agent.</small>
              </span>
            </label>

            <div v-if="ctx.detail?.otherFields.length" class="field-group">
              <span class="field-label">Other fields</span>
              <div class="field-footer">Kept as-is on save.</div>
              <pre class="field-input field-input--mono">{{
                ctx.detail.otherFields.map((f) => `${f.key}: ${f.value}`).join("\n")
              }}</pre>
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>
