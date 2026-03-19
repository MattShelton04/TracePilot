<script setup lang="ts">
import { FormInput, FormSwitch, SectionPanel } from '@tracepilot/ui';
import { ref } from 'vue';

const healthScoringEnabled = ref(true);

// STUB: Health scoring thresholds — wire to health scoring config when backend ready
const thresholdGood = ref(80);
const thresholdWarning = ref(50);
const thresholdCritical = ref(50);

// STUB: Health flag configuration stored locally — sync with backend when available
const flagHighRetries = ref(true);
const flagLongDuration = ref(true);
const flagLargeTokenUsage = ref(true);
const flagManyErrors = ref(false);
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">Health Scoring</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Enable health scoring</div>
          <div class="setting-description">
            Analyze sessions for potential issues
          </div>
        </div>
        <FormSwitch v-model="healthScoringEnabled" />
      </div>

      <!-- STUB: Health scoring thresholds — wire to health scoring config when backend ready -->
      <div class="setting-row" v-if="healthScoringEnabled">
        <div class="setting-info">
          <div class="setting-label">Score thresholds</div>
          <div class="setting-description">
            Good (&gt;80), Warning (&gt;50), Critical (≤50)
          </div>
        </div>
        <div class="setting-control-group">
          <div class="threshold-input">
            <label class="threshold-label good">Good</label>
            <FormInput
              type="number"
              v-model="thresholdGood"
              class="input-threshold"
            />
          </div>
          <div class="threshold-input">
            <label class="threshold-label warning">Warn</label>
            <FormInput
              type="number"
              v-model="thresholdWarning"
              class="input-threshold"
            />
          </div>
          <div class="threshold-input">
            <label class="threshold-label critical">Crit</label>
            <FormInput
              type="number"
              v-model="thresholdCritical"
              class="input-threshold"
            />
          </div>
        </div>
      </div>

      <!-- STUB: Health flag configuration stored locally — sync with backend when available -->
      <div class="setting-row" v-if="healthScoringEnabled">
        <div class="setting-info">
          <div class="setting-label">Flags to monitor</div>
          <div class="setting-description">
            Conditions that lower a session's health score
          </div>
        </div>
        <div class="flag-checkboxes">
          <label class="flag-checkbox">
            <input type="checkbox" v-model="flagHighRetries" />
            <span>High retries</span>
          </label>
          <label class="flag-checkbox">
            <input type="checkbox" v-model="flagLongDuration" />
            <span>Long duration</span>
          </label>
          <label class="flag-checkbox">
            <input type="checkbox" v-model="flagLargeTokenUsage" />
            <span>Large token usage</span>
          </label>
          <label class="flag-checkbox">
            <input type="checkbox" v-model="flagManyErrors" />
            <span>Many errors</span>
          </label>
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.threshold-input {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.threshold-label {
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
}

.threshold-label.good {
  color: var(--success-fg);
}
.threshold-label.warning {
  color: var(--warning-fg);
}
.threshold-label.critical {
  color: var(--danger-fg);
}

.flag-checkboxes {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flag-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.flag-checkbox input[type="checkbox"] {
  accent-color: var(--accent-emphasis);
}

.input-threshold {
  width: 60px;
  text-align: center;
}
</style>
