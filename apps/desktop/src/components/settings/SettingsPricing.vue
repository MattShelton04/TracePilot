<script setup lang="ts">
import { ActionButton, FormInput, SectionPanel } from '@tracepilot/ui';
import { ref } from 'vue';
import { usePreferencesStore } from '@/stores/preferences';

const preferences = usePreferencesStore();

const newModelName = ref('');
const newInputPerM = ref(0);
const newCachedInputPerM = ref(0);
const newOutputPerM = ref(0);
const newPremiumRequests = ref(1);

function addModelPrice() {
  if (!newModelName.value.trim()) return;
  preferences.addWholesalePrice({
    model: newModelName.value.trim(),
    inputPerM: newInputPerM.value,
    cachedInputPerM: newCachedInputPerM.value,
    outputPerM: newOutputPerM.value,
    premiumRequests: newPremiumRequests.value,
  });
  newModelName.value = '';
  newInputPerM.value = 0;
  newCachedInputPerM.value = 0;
  newOutputPerM.value = 0;
  newPremiumRequests.value = 1;
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
            GitHub Copilot charges per premium request. Cost = premiumRequests × this rate.
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
          />
        </div>
      </div>
    </SectionPanel>

    <div class="pricing-subsection-title">Model Wholesale Prices</div>
    <p class="pricing-description">
      API prices ($ per 1M tokens) used to compute what sessions would cost through direct API access vs. Copilot premium requests.
    </p>

    <SectionPanel>
      <div class="pricing-table-wrapper">
        <table class="data-table pricing-table" aria-label="Model wholesale pricing">
          <thead>
            <tr>
              <th class="text-left">Model</th>
              <th>Input / 1M</th>
              <th>Cached / 1M</th>
              <th>Output / 1M</th>
              <th>Premium Req.</th>
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
                />
              </td>
              <td class="text-center">
                <button class="pricing-remove-btn" @click="preferences.removeWholesalePrice(price.model)" title="Remove model">&times;</button>
              </td>
            </tr>
            <!-- Add new model row -->
            <tr class="pricing-add-row">
              <td>
                <FormInput
                  v-model="newModelName"
                  placeholder="model-name"
                  class="pricing-model-input"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newInputPerM"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newCachedInputPerM"
                  step="0.001"
                  min="0"
                  class="pricing-input"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newOutputPerM"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                />
              </td>
              <td class="text-center">
                <FormInput
                  type="number"
                  v-model="newPremiumRequests"
                  step="0.01"
                  min="0"
                  class="pricing-input"
                />
              </td>
              <td class="text-center">
                <button class="pricing-add-btn" @click="addModelPrice" :disabled="!newModelName.trim()" title="Add model">+</button>
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
</style>
