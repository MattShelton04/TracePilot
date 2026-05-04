<script setup lang="ts">
import { ActionButton, FormInput, SectionPanel } from "@tracepilot/ui";
import { ref } from "vue";
import { usePreferencesStore } from "@/stores/preferences";

const preferences = usePreferencesStore();

const newModelName = ref("");
const newInputPerM = ref(0);
const newCachedInputPerM = ref(0);
const newCacheWritePerM = ref(0);
const newOutputPerM = ref(0);
const newPremiumRequests = ref(1);

function addModelPrice() {
  if (!newModelName.value.trim()) return;
  preferences.addWholesalePrice({
    model: newModelName.value.trim(),
    inputPerM: newInputPerM.value,
    cachedInputPerM: newCachedInputPerM.value,
    cacheWritePerM: newCacheWritePerM.value,
    outputPerM: newOutputPerM.value,
    premiumRequests: newPremiumRequests.value,
    status: "user-override",
    sourceLabel: "Local settings override",
  });
  newModelName.value = "";
  newInputPerM.value = 0;
  newCachedInputPerM.value = 0;
  newCacheWritePerM.value = 0;
  newOutputPerM.value = 0;
  newPremiumRequests.value = 1;
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
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Pricing</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Cost per premium request</div>
          <div class="setting-description">
            Legacy Copilot estimate for premium-request sessions. Usage-based billing uses token rates below and official GitHub Copilot rates where available.
          </div>
        </div>
        <div class="setting-control-group">
          <span class="setting-unit">$</span>
          <FormInput
            type="number"
            :model-value="preferences.costPerPremiumRequest"
            @update:model-value="preferences.costPerPremiumRequest = Number($event)"
            step="0.01"
            min="0"
            class="input-cost"
            aria-label="Cost per premium request in dollars"
          />
        </div>
      </div>
    </SectionPanel>

    <div class="pricing-subsection-title">Model Pricing Overrides</div>
    <p class="pricing-description">
      Local direct-API/provider prices ($ per 1M tokens) used for configurable estimates. Defaults mirror GitHub Copilot's published token rates for documented models; edits here intentionally override that local estimate.
    </p>

    <SectionPanel>
      <div class="pricing-table-wrapper">
        <table class="data-table pricing-table" aria-label="Model wholesale pricing">
          <thead>
            <tr>
              <th class="text-left">Model</th>
               <th>Input / 1M</th>
               <th>Cached / 1M</th>
               <th>Cache Write / 1M</th>
               <th>Output / 1M</th>
               <th>Premium Req.</th>
               <th>Source</th>
               <th class="pricing-col-action"></th>
             </tr>
          </thead>
          <tbody>
            <tr v-for="(price, idx) in preferences.modelWholesalePrices" :key="price.model">
              <td class="font-mono text-xs">{{ price.model }}</td>
              <td class="text-center">
                <FormInput
                  type="number"
                  :model-value="price.inputPerM"
                  @update:model-value="preferences.modelWholesalePrices[idx].inputPerM = Number($event)"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  :aria-label="`${price.model} input price per 1M tokens`"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  :model-value="price.cachedInputPerM"
                  @update:model-value="preferences.modelWholesalePrices[idx].cachedInputPerM = Number($event)"
                  step="0.001"
                  min="0"
                  class="pricing-input"
                  :aria-label="`${price.model} cached input price per 1M tokens`"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  :model-value="price.cacheWritePerM ?? 0"
                  @update:model-value="preferences.modelWholesalePrices[idx].cacheWritePerM = Number($event)"
                  step="0.001"
                  min="0"
                  class="pricing-input"
                  :aria-label="`${price.model} cache write price per 1M tokens`"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  :model-value="price.outputPerM"
                  @update:model-value="preferences.modelWholesalePrices[idx].outputPerM = Number($event)"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  :aria-label="`${price.model} output price per 1M tokens`"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  :model-value="price.premiumRequests"
                  @update:model-value="preferences.modelWholesalePrices[idx].premiumRequests = Number($event)"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  :aria-label="`${price.model} premium requests`"
                />
              </td>
              <td class="pricing-meta-cell" :title="sourceTooltip(price.model)">
                <span class="pricing-source-label">{{ sourceLabel(price.model) }}</span>
                <span class="pricing-source-meta">{{ sourceSummary(price.model) }}</span>
              </td>
              <td class="text-center">
                <button class="pricing-remove-btn" @click="preferences.removeWholesalePrice(price.model)" :title="`Remove ${price.model}`" :aria-label="`Remove pricing for ${price.model}`">&times;</button>
              </td>
            </tr>
            <!-- Add new model row -->
            <tr class="pricing-add-row">
              <td>
                <FormInput
                  v-model="newModelName"
                  placeholder="model-name"
                  class="pricing-model-input"
                  aria-label="New model name"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newInputPerM"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  aria-label="New model input price per 1M tokens"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newCachedInputPerM"
                  step="0.001"
                  min="0"
                  class="pricing-input"
                  aria-label="New model cached input price per 1M tokens"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newCacheWritePerM"
                  step="0.001"
                  min="0"
                  class="pricing-input"
                  aria-label="New model cache write price per 1M tokens"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newOutputPerM"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  aria-label="New model output price per 1M tokens"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newPremiumRequests"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                  aria-label="New model premium requests"
                />
              </td>
              <td class="pricing-meta-cell" title="Local settings override&#10;Status: user-override&#10;Effective: always">
                <span class="pricing-source-label">Local settings override</span>
                <span class="pricing-source-meta">user-override · always</span>
              </td>
              <td class="text-center">
                <button class="pricing-add-btn" @click="addModelPrice" :disabled="!newModelName.trim()" title="Add model" aria-label="Add model pricing entry">+</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pricing-actions">
        <ActionButton size="sm" @click="preferences.resetWholesalePrices()">Reset to Defaults</ActionButton>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.pricing-subsection-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin: 12px 0 4px;
}

.pricing-description {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-bottom: 10px;
  line-height: 1.5;
}

.pricing-table-wrapper {
  overflow-x: auto;
}

.pricing-table th {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-tertiary);
  padding: 8px 6px;
}

.pricing-table td {
  padding: 4px 6px;
  vertical-align: middle;
}

.pricing-remove-btn {
  background: none;
  border: none;
  color: var(--danger-fg);
  font-size: 1.125rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  line-height: 1;
  opacity: 0.6;
  transition: opacity 100ms ease;
}

.pricing-remove-btn:hover {
  opacity: 1;
  background: var(--danger-subtle);
}

.pricing-add-btn {
  background: none;
  border: 1px solid var(--border-default);
  color: var(--accent-fg);
  font-size: 1rem;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: all 100ms ease;
}

.pricing-add-btn:hover:not(:disabled) {
  background: var(--accent-subtle);
}

.pricing-add-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pricing-add-row td {
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}

.pricing-actions {
  padding: 10px 16px;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  justify-content: flex-end;
}

.pricing-col-action {
  width: 40px;
}

.pricing-input {
  width: 80px;
  text-align: center;
  font-size: 0.75rem;
}

.pricing-model-input {
  width: 140px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
}

.pricing-meta-cell {
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary);
  font-size: 0.6875rem;
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
</style>
