<script setup lang="ts">
/**
 * What this agent actually runs with, and where each value comes from. An
 * explicit `model` in the launching task call still wins over everything
 * here, which the footnote says.
 */
import { Badge, Banner } from "@tracepilot/ui";
import { computed } from "vue";
import { useAgentEditorContext } from "@/composables/useAgentEditor";
import type { ConfigSource } from "@/utils/agents/effective";

const ctx = useAgentEditorContext();

const SOURCE_TONE: Record<ConfigSource, "accent" | "neutral" | "done"> = {
  settings: "accent",
  definition: "neutral",
  session: "done",
  cli: "neutral",
};

const SOURCE_LABEL: Record<ConfigSource, string> = {
  settings: "/subagents",
  definition: "definition",
  session: "session",
  cli: "CLI default",
};

const rows = computed(() => {
  const config = ctx.effective;
  return [
    ...config.models.map((model, index) => ({
      key: `model-${index}`,
      label: index === 0 ? "Model" : `Fallback ${index}`,
      value: model.value ?? "not recorded",
      source: model.source,
      detail: model.detail,
    })),
    {
      key: "effort",
      label: "Reasoning effort",
      value: config.effort.value ?? "not recorded",
      source: config.effort.source,
      detail: config.effort.detail,
    },
    {
      key: "context",
      label: "Context tier",
      value: config.contextTier.value ?? "not recorded",
      source: config.contextTier.source,
      detail: config.contextTier.detail,
    },
  ];
});

/** A built-in can list dozens of tools, so the names go behind a disclosure. */
const tools = computed(() => ctx.effective.tools);
const toolsSummary = computed(() => {
  const list = tools.value.value;
  if (!list) return "every tool";
  return `${list.length} tool${list.length === 1 ? "" : "s"}`;
});
</script>

<template>
  <div class="effective">
    <Banner v-if="ctx.effective.disabled" tone="warning" title="Disabled">
      This agent is listed in <code>disabledSubagents</code>, so the CLI will not run it.
    </Banner>
    <Banner v-else-if="ctx.effective.modelPolicyRequired" tone="info" title="Model required">
      <code>model-policy: required</code> — the CLI fails rather than falling back to another model.
    </Banner>

    <dl class="effective__list">
      <div v-for="row in rows" :key="row.key" class="effective__row">
        <dt class="effective__label">{{ row.label }}</dt>
        <dd class="effective__value">
          <span class="effective__resolved">{{ row.value }}</span>
          <Badge :variant="SOURCE_TONE[row.source]">{{ SOURCE_LABEL[row.source] }}</Badge>
          <p class="effective__detail">{{ row.detail }}</p>
        </dd>
      </div>

      <div class="effective__row">
        <dt class="effective__label">Tools</dt>
        <dd class="effective__value">
          <span class="effective__resolved">{{ toolsSummary }}</span>
          <Badge :variant="SOURCE_TONE[tools.source]">{{ SOURCE_LABEL[tools.source] }}</Badge>
          <p class="effective__detail">{{ tools.detail }}</p>
          <details v-if="tools.value?.length" class="effective__tools">
            <summary>Show tool names</summary>
            <ul>
              <li v-for="tool in tools.value" :key="tool">{{ tool }}</li>
            </ul>
          </details>
        </dd>
      </div>
    </dl>

    <p v-if="ctx.settings?.settingsPath" class="effective__footnote">
      Overrides live in <code>{{ ctx.settings.settingsPath }}</code>.
    </p>
    <p class="effective__footnote">
      A <code>model</code> passed in the launching task call wins over every value above.
    </p>
  </div>
</template>

<style scoped>
.effective {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.effective__list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.effective__row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: start;
}

.effective__label {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-top: 2px;
}

.effective__value {
  margin: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.effective__resolved {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  color: var(--text-primary);
  word-break: break-word;
}

.effective__detail {
  flex-basis: 100%;
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.effective__tools {
  flex-basis: 100%;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.effective__tools summary {
  cursor: pointer;
  color: var(--accent-fg);
}

.effective__tools ul {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  max-height: 180px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px;
  font-family: var(--font-mono);
}

.effective__footnote {
  margin: 0;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
}

.effective__footnote code,
.effective code {
  font-family: var(--font-mono);
}
</style>
