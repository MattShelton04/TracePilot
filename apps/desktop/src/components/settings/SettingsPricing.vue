<script setup lang="ts">
import type { ModelPriceEntry } from "@tracepilot/types";
import { ActionButton, FormInput, SearchInput, SectionPanel } from "@tracepilot/ui";
import { computed, reactive, ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const newModelName = ref("");
const newRates = reactive<Record<RateField, number>>({
  inputPerM: 0,
  cachedInputPerM: 0,
  cacheWritePerM: 0,
  outputPerM: 0,
});
const modelSearch = ref("");

type RateField = "inputPerM" | "cachedInputPerM" | "cacheWritePerM" | "outputPerM";

const RATE_COLUMNS: readonly {
  field: RateField;
  label: string;
  description: string;
  step: string;
}[] = [
  { field: "inputPerM", label: "Input", description: "Input", step: "0.01" },
  {
    field: "cachedInputPerM",
    label: "Cached read",
    description: "Cached input",
    step: "0.001",
  },
  {
    field: "cacheWritePerM",
    label: "Cache write",
    description: "Cache write",
    step: "0.001",
  },
  { field: "outputPerM", label: "Output", description: "Output", step: "0.01" },
];

const FAMILY_DEFINITIONS = [
  { id: "claude", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "other", label: "Other models" },
] as const;

type FamilyId = (typeof FAMILY_DEFINITIONS)[number]["id"];

function modelFamily(model: string): FamilyId {
  const normalized = model.toLowerCase();
  if (normalized.startsWith("claude-")) return "claude";
  if (normalized.startsWith("gpt-") || /^o[134]-/.test(normalized)) return "openai";
  if (normalized.startsWith("gemini-")) return "gemini";
  return "other";
}

function sourceLabel(model: string): string {
  const metadata = preferences.getPricingMetadata(model, "provider-wholesale");
  return metadata?.sourceLabel ?? "Local settings override";
}

function effectiveLabel(model: string): string {
  const metadata = preferences.getPricingMetadata(model, "provider-wholesale");
  return metadata?.effectiveFrom ?? "always";
}

function statusLabel(model: string): string {
  const metadata = preferences.getPricingMetadata(model, "provider-wholesale");
  return metadata?.status ?? "estimated";
}

function sourceSummary(model: string): string {
  return `${statusLabel(model)} · ${effectiveLabel(model)}`;
}

function sourceTooltip(model: string): string {
  return `${sourceLabel(model)}\nStatus: ${statusLabel(model)}\nEffective: ${effectiveLabel(model)}`;
}

function contextLabel(price: Pick<ModelPriceEntry, "pricingTier" | "minimumInputTokens">): string {
  if (price.pricingTier === "long-context" && price.minimumInputTokens != null) {
    return `Long context (>${(price.minimumInputTokens - 1).toLocaleString()} tokens)`;
  }
  return "Default context";
}

const normalizedSearch = computed(() => modelSearch.value.trim().toLowerCase());

const priceGroups = computed(() =>
  FAMILY_DEFINITIONS.map((family) => ({
    ...family,
    rows: preferences.modelWholesalePrices
      .map((price, index) => ({ price, index }))
      .filter(({ price }) => modelFamily(price.model) === family.id)
      .filter(({ price }) => {
        if (!normalizedSearch.value) return true;
        return [price.model, contextLabel(price), sourceLabel(price.model)]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch.value);
      }),
  })).filter((family) => family.rows.length > 0),
);

const visibleRateCount = computed(() =>
  priceGroups.value.reduce((count, family) => count + family.rows.length, 0),
);

function addModelPrice() {
  const model = newModelName.value.trim();
  if (!model) return;
  preferences.addWholesalePrice({
    model,
    ...newRates,
    premiumRequests: 1,
    status: "user-override",
    sourceLabel: "Local settings override",
  });
  newModelName.value = "";
  for (const column of RATE_COLUMNS) newRates[column.field] = 0;
}

function updateRate(index: number, field: RateField, value: unknown) {
  preferences.modelWholesalePrices[index][field] = Number(value);
}
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">AI Credit Tracking</div>
    <p class="pricing-description">
      TracePilot uses the most reliable cost data available for each session. Local fallback rates
      affect estimates only; they never replace observed AI Credit telemetry.
    </p>

    <div class="fallback-chain" aria-label="AI Credit estimate priority">
      <div class="fallback-step">
        <span class="fallback-step-number">1</span>
        <span><strong>Observed AIC</strong><small>Billing telemetry</small></span>
      </div>
      <span class="fallback-chain-arrow" aria-hidden="true">→</span>
      <div class="fallback-step">
        <span class="fallback-step-number">2</span>
        <span><strong>GitHub rate</strong><small>Published token pricing</small></span>
      </div>
      <span class="fallback-chain-arrow" aria-hidden="true">→</span>
      <div class="fallback-step">
        <span class="fallback-step-number">3</span>
        <span><strong>Local fallback</strong><small>Rates edited below</small></span>
      </div>
    </div>

    <SectionPanel title="AIC Estimate Fallback Rates">
      <template #actions>
        <ActionButton size="sm" @click="preferences.resetWholesalePrices()">
          Reset defaults
        </ActionButton>
      </template>

      <p class="pricing-description pricing-description--panel">
        USD per 1 million tokens. Expand a model family to review or edit its rates.
      </p>

      <div class="pricing-toolbar">
        <SearchInput
          v-model="modelSearch"
          placeholder="Search models or sources"
          class="pricing-search"
        />
        <span class="pricing-result-count" aria-live="polite">
          {{ visibleRateCount }} rate{{ visibleRateCount === 1 ? "" : "s" }}
        </span>
      </div>

      <div v-if="priceGroups.length" class="pricing-groups">
        <details
          v-for="group in priceGroups"
          :key="group.id"
          class="pricing-group"
          :open="Boolean(normalizedSearch)"
        >
          <summary class="pricing-group-summary">
            <span class="pricing-group-chevron" aria-hidden="true" />
            <span class="pricing-group-name">{{ group.label }}</span>
            <span class="pricing-group-count">
              {{ group.rows.length }} rate{{ group.rows.length === 1 ? "" : "s" }}
            </span>
          </summary>

          <div class="pricing-table-wrapper">
            <table class="data-table pricing-table" :aria-label="`${group.label} fallback rates`">
              <thead>
                <tr>
                  <th class="text-left">Model</th>
                  <th v-for="column in RATE_COLUMNS" :key="column.field">
                    {{ column.label }}
                  </th>
                  <th class="text-left">Source</th>
                  <th class="pricing-col-action"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="{ price, index } in group.rows"
                  :key="`${price.model}:${price.pricingTier ?? 'default'}:${price.minimumInputTokens ?? 0}`"
                >
                  <td class="pricing-model-cell">
                    <span class="font-mono text-xs">{{ price.model }}</span>
                    <span class="pricing-context">{{ contextLabel(price) }}</span>
                  </td>
                  <td v-for="column in RATE_COLUMNS" :key="column.field" class="text-center">
                    <FormInput
                      type="number"
                      :model-value="price[column.field] ?? 0"
                      @update:model-value="updateRate(index, column.field, $event)"
                      :step="column.step"
                      min="0"
                      class="pricing-input"
                      :aria-label="`${price.model} ${column.description.toLowerCase()} price per 1M tokens`"
                    />
                  </td>
                  <td class="pricing-meta-cell" :title="sourceTooltip(price.model)">
                    <span class="pricing-source-label">{{ sourceLabel(price.model) }}</span>
                    <span class="pricing-source-meta">{{ sourceSummary(price.model) }}</span>
                  </td>
                  <td class="text-center">
                    <button
                      type="button"
                      class="pricing-remove-btn"
                      @click="preferences.removeWholesalePrice(price.model)"
                      :title="`Remove all fallback rates for ${price.model}`"
                      :aria-label="`Remove all fallback rates for ${price.model}`"
                    >&times;</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </div>
      <div v-else class="pricing-empty">
        No fallback rates match “{{ modelSearch }}”.
      </div>

      <details class="custom-rate">
        <summary class="custom-rate-summary">Add a custom fallback rate</summary>
        <div class="custom-rate-form">
          <label class="custom-rate-field custom-rate-field--model">
            <span>Model ID</span>
            <FormInput
              v-model="newModelName"
              placeholder="model-name"
              class="pricing-model-input"
            />
          </label>
          <label v-for="column in RATE_COLUMNS" :key="column.field" class="custom-rate-field">
            <span>{{ column.label }}</span>
            <FormInput
              :model-value="newRates[column.field]"
              @update:model-value="newRates[column.field] = Number($event)"
              type="number"
              :step="column.step"
              min="0"
              class="pricing-input"
            />
          </label>
          <ActionButton size="sm" :disabled="!newModelName.trim()" @click="addModelPrice">
            Add rate
          </ActionButton>
        </div>
      </details>
    </SectionPanel>
  </div>
</template>

<style scoped>
.pricing-description {
  margin-bottom: 10px;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  line-height: 1.5;
}

.pricing-description--panel {
  margin: 0 0 12px;
}

.fallback-chain {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--canvas-subtle);
}

.fallback-step {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.fallback-step > span:last-child {
  display: flex;
  flex-direction: column;
}

.fallback-step strong {
  color: var(--text-primary);
  font-weight: 600;
}

.fallback-step small {
  color: var(--text-tertiary);
  font-size: 0.625rem;
}

.fallback-step-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent-muted);
  color: var(--accent-fg);
  font-size: 0.6875rem;
  font-weight: 700;
}

.fallback-chain-arrow {
  color: var(--text-placeholder);
}

.pricing-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.pricing-search {
  flex: 1;
  max-width: 360px;
}

.pricing-result-count {
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.pricing-groups {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.pricing-group + .pricing-group {
  border-top: 1px solid var(--border-subtle);
}

.pricing-group-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  list-style: none;
  transition: background var(--transition-fast);
}

.pricing-group-summary::-webkit-details-marker {
  display: none;
}

.pricing-group-summary:hover {
  background: var(--canvas-raised);
}

.pricing-group-summary:focus-visible {
  outline: 2px solid var(--accent-emphasis);
  outline-offset: -2px;
}

.pricing-group-chevron {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
  transition: transform var(--transition-fast);
}

.pricing-group[open] .pricing-group-chevron {
  transform: rotate(45deg);
}

.pricing-group-name {
  color: var(--text-primary);
  font-size: 0.75rem;
  font-weight: 600;
}

.pricing-group-count {
  margin-left: auto;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
}

.pricing-table-wrapper {
  overflow-x: auto;
  border-top: 1px solid var(--border-subtle);
}

.pricing-table {
  min-width: 780px;
}

.pricing-table th {
  padding: 8px 6px;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.pricing-table td {
  padding: 6px;
  vertical-align: middle;
}

.pricing-model-cell {
  min-width: 170px;
}

.pricing-context {
  display: block;
  margin-top: 2px;
  color: var(--text-tertiary);
  font-size: 0.625rem;
}

.pricing-input {
  width: 76px;
  font-size: 0.75rem;
  text-align: center;
}

.pricing-model-input {
  width: 180px;
  font-family: "JetBrains Mono", monospace;
  font-size: 0.75rem;
}

.pricing-meta-cell {
  width: 170px;
  max-width: 170px;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pricing-source-label,
.pricing-source-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pricing-source-label {
  color: var(--text-secondary);
  font-weight: 600;
}

.pricing-col-action {
  width: 40px;
}

.pricing-remove-btn {
  padding: 2px 6px;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--danger-fg);
  cursor: pointer;
  font-size: 1.125rem;
  line-height: 1;
  opacity: 0.6;
  transition: opacity 100ms ease;
}

.pricing-remove-btn:hover {
  background: var(--danger-subtle);
  opacity: 1;
}

.pricing-empty {
  padding: 24px;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-tertiary);
  font-size: 0.75rem;
  text-align: center;
}

.custom-rate {
  margin-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.custom-rate-summary {
  width: fit-content;
  padding: 10px 0 4px;
  color: var(--accent-fg);
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
}

.custom-rate-form {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding-top: 10px;
  overflow-x: auto;
}

.custom-rate-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex-shrink: 0;
  color: var(--text-tertiary);
  font-size: 0.625rem;
  font-weight: 600;
}

@media (max-width: 760px) {
  .fallback-chain {
    align-items: stretch;
    flex-direction: column;
  }

  .fallback-chain-arrow {
    display: none;
  }
}
</style>
