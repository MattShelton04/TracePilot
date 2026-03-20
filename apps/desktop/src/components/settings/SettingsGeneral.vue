<script setup lang="ts">
import { BtnGroup, FormInput, FormSwitch, SectionPanel } from '@tracepilot/ui';
import { ref } from 'vue';
import { type ThemeOption, usePreferencesStore } from '@/stores/preferences';
import { useSessionsStore } from '@/stores/sessions';

const preferences = usePreferencesStore();
const sessionsStore = useSessionsStore();

const themeOptions = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const defaultViewOptions = [
  { value: 'sessions', label: 'Sessions' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'health', label: 'Health' },
];

const defaultView = ref('sessions');
const itemsPerPage = ref(20);
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">General</div>
    <SectionPanel>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Theme</div>
          <div class="setting-description">
            Switch between dark and light mode
          </div>
        </div>
        <BtnGroup
          :options="themeOptions"
          :model-value="preferences.theme"
          @update:model-value="preferences.theme = $event as ThemeOption"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Default view</div>
          <div class="setting-description">
            Landing page when the app opens
          </div>
        </div>
        <BtnGroup
          :options="defaultViewOptions"
          v-model="defaultView"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Items per page</div>
          <div class="setting-description">
            Number of sessions shown per page
          </div>
        </div>
        <FormInput
          type="number"
          v-model="itemsPerPage"
          class="input-narrow-center"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Hide empty sessions</div>
          <div class="setting-description">
            Filter out sessions with no conversation turns (e.g., auto-created sessions).
            <span v-if="sessionsStore.emptySessionCount > 0" class="empty-count-hint">
              {{ sessionsStore.emptySessionCount }} empty session{{ sessionsStore.emptySessionCount !== 1 ? 's' : '' }} currently filtered out
            </span>
          </div>
        </div>
        <FormSwitch
          :model-value="preferences.hideEmptySessions"
          @update:model-value="preferences.hideEmptySessions = $event"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">CLI Command</div>
          <div class="setting-description">
            The command used to resume Copilot sessions (e.g., <code>copilot</code> or <code>gh copilot-cli</code>)
          </div>
        </div>
        <FormInput
          :model-value="preferences.cliCommand"
          @update:model-value="preferences.cliCommand = String($event)"
          type="text"
          placeholder="copilot"
          class="input-medium"
        />
      </div>
    </SectionPanel>
  </div>
</template>
