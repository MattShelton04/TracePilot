<script setup lang="ts">
import type { AgentDefinition } from "@tracepilot/types";
import { getAllModelIds, getModelsByTier, getModelTier, getTierLabel } from "@tracepilot/types";
import { EmptyState, StatCard, truncateText } from "@tracepilot/ui";
import { computed } from "vue";
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
  upgradeAgent,
  batchUpgrading,
  upgradeAllToOpus,
  resetAllDefaults,
} = ctx;

const ALL_MODELS = getAllModelIds();
const PREMIUM_MODELS = getModelsByTier("premium").map((m) => m.id);
const STANDARD_MODELS = getModelsByTier("standard").map((m) => m.id);
const FAST_MODELS = getModelsByTier("fast").map((m) => m.id);

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
        :value="premiumAgentCount"
        label="Premium Agents"
        color="warning"
        label-style="uppercase"
      />
      <StatCard
        :value="ALL_MODELS.length"
        label="Models Available"
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

          <button
            v-if="modelTier(agentModels[agent.filePath] ?? agent.model) !== 'premium'"
            class="btn-upgrade"
            :disabled="store.saving"
            @click="upgradeAgent(agent)"
          >
            ⬆ Upgrade
          </button>
          <span v-else class="premium-active-badge">✓ Premium</span>
          <Transition name="banner">
            <span v-if="autoSavedAgent === agent.filePath" class="auto-saved-hint">(auto-saved)</span>
          </Transition>
        </div>
      </div>

      <EmptyState v-if="!store.agents.length" compact message="No agent definitions found." />
    </div>

    <!-- Batch Actions -->
    <div v-if="store.agents.length" class="batch-actions">
      <span class="batch-label">Batch action:</span>
      <button
        class="btn-gradient"
        :disabled="store.saving || batchUpgrading"
        @click="upgradeAllToOpus"
      >
        {{ batchUpgrading ? 'Upgrading…' : '⬆ Upgrade All to Opus 4.6' }}
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
