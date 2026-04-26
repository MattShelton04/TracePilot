<script setup lang="ts">
import type { AgentDefinition } from "@tracepilot/types";
import { getAllModelIds, getModelsByTier, getModelTier, getTierLabel } from "@tracepilot/types";
import { EmptyState, StatCard, truncateText } from "@tracepilot/ui";
import { computed, ref } from "vue";
import { TOOLS_COLLAPSE_LIMIT, useConfigInjectorContext } from "@/composables/useConfigInjector";
import { agentMeta } from "./agentMeta";

const ctx = useConfigInjectorContext();
const {
  store,
  expandedTools,
  visibleTools,
  hiddenToolCount,
  autoSavedAgent,
  agentModels,
  onAgentModelSelect,
  batchApplying,
  setAllAgentsToModel,
  resetAllDefaults,
} = ctx;

const ALL_MODELS = getAllModelIds();
const PREMIUM_MODELS = getModelsByTier("premium").map((m) => m.id);
const STANDARD_MODELS = getModelsByTier("standard").map((m) => m.id);
const FAST_MODELS = getModelsByTier("fast").map((m) => m.id);

// Default the batch picker to GPT-5.4 — neutral, non-"premium-upgrade"
// framing. Users can pick any other model from the dropdown.
const DEFAULT_BATCH_MODEL = "gpt-5.4";
const batchTargetModel = ref<string>(
  ALL_MODELS.includes(DEFAULT_BATCH_MODEL) ? DEFAULT_BATCH_MODEL : (ALL_MODELS[0] ?? ""),
);

function modelTier(model: string): "premium" | "standard" | "fast" {
  return getModelTier(model);
}

function tierLabel(tier: string): string {
  return getTierLabel(tier as "premium" | "standard" | "fast");
}

const uniqueModelCount = computed(() => new Set(store.agents.map((a) => a.model)).size);
const premiumAgentCount = computed(
  () => store.agents.filter((a: AgentDefinition) => PREMIUM_MODELS.includes(a.model)).length,
);
// Sum of premium-request weight across all agents — informational stat that
// reflects "cost shape" without nudging towards more expensive models.
const totalPremiumWeight = computed(() => {
  let total = 0;
  for (const agent of store.agents) {
    const def = getModelsByTier("premium").find((m) => m.id === agent.model);
    if (def) total += def.premiumRequests;
  }
  return Number(total.toFixed(2));
});
</script>

<template>
  <div class="tab-panel">
    <!-- Stat Cards -->
    <div class="stat-grid">
      <StatCard
        :value="store.agents.length"
        label="Agent Definitions"
        color="accent"
        label-style="uppercase"
      />
      <StatCard
        :value="uniqueModelCount"
        label="Unique Models Used"
        color="done"
        label-style="uppercase"
      />
      <StatCard
        :value="`${premiumAgentCount} / ${store.agents.length}`"
        label="On Premium Models"
        color="warning"
        label-style="uppercase"
      />
      <StatCard
        :value="totalPremiumWeight"
        label="Total Premium Weight"
        color="success"
        label-style="uppercase"
      />
    </div>

    <!-- Agent Grid -->
    <div class="agent-grid">
      <div
        v-for="agent in store.agents"
        :key="agent.filePath"
        class="agent-card"
        :style="{ '--agent-accent': `var(${agentMeta(agent.name).colorVar})` }"
      >
        <div class="agent-header">
          <div class="agent-icon">
            {{ agentMeta(agent.name).emoji }}
          </div>
          <div class="agent-info">
            <span class="agent-name">{{ agent.name }}</span>
            <span
              class="tier-badge"
              :class="`tier-badge--${modelTier(agentModels[agent.filePath] ?? agent.model)}`"
            >
              {{ tierLabel(modelTier(agentModels[agent.filePath] ?? agent.model)) }}
            </span>
          </div>
        </div>

        <p class="agent-desc">
          {{ agent.description || agentMeta(agent.name).motto }}
        </p>

        <div v-if="agent.tools?.length" class="agent-tools">
          <span
            v-for="tool in visibleTools(agent)"
            :key="tool"
            class="tool-chip"
            :title="tool.length > 50 ? tool : undefined"
          >{{ truncateText(tool, 50) }}</span>
          <span
            v-if="hiddenToolCount(agent) > 0 && !expandedTools[agent.filePath]"
            class="tool-chip tool-chip--more"
            @click="expandedTools[agent.filePath] = true"
          >
            +{{ hiddenToolCount(agent) }} more
          </span>
          <span
            v-if="expandedTools[agent.filePath] && agent.tools.length > TOOLS_COLLAPSE_LIMIT"
            class="tool-chip tool-chip--more"
            @click="expandedTools[agent.filePath] = false"
          >
            Show less
          </span>
        </div>

        <div class="agent-model-section">
          <select
            v-model="agentModels[agent.filePath]"
            class="form-input model-select"
            @change="onAgentModelSelect(agent)"
          >
            <optgroup label="Premium">
              <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
            <optgroup label="Standard">
              <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
            <optgroup label="Fast / Cheap">
              <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
            </optgroup>
          </select>
          <Transition name="banner">
            <span v-if="autoSavedAgent === agent.filePath" class="auto-saved-hint">(auto-saved)</span>
          </Transition>
        </div>
      </div>

      <EmptyState v-if="!store.agents.length" compact message="No agent definitions found." />
    </div>

    <!-- Batch Actions -->
    <div v-if="store.agents.length" class="batch-actions">
      <span class="batch-label">Set all agents to:</span>
      <select
        v-model="batchTargetModel"
        class="form-input batch-model-select"
        :disabled="store.saving || batchApplying"
        aria-label="Batch target model"
      >
        <optgroup label="Premium">
          <option v-for="m in PREMIUM_MODELS" :key="m" :value="m">{{ m }}</option>
        </optgroup>
        <optgroup label="Standard">
          <option v-for="m in STANDARD_MODELS" :key="m" :value="m">{{ m }}</option>
        </optgroup>
        <optgroup label="Fast / Cheap">
          <option v-for="m in FAST_MODELS" :key="m" :value="m">{{ m }}</option>
        </optgroup>
      </select>
      <button
        class="btn btn-sm"
        :disabled="store.saving || batchApplying || !batchTargetModel"
        @click="setAllAgentsToModel(batchTargetModel)"
      >
        {{ batchApplying ? 'Applying…' : 'Apply' }}
      </button>
      <button
        class="btn btn-sm"
        :disabled="store.saving"
        @click="resetAllDefaults"
      >
        ↩ Reload from Disk
      </button>
    </div>
  </div>
</template>
