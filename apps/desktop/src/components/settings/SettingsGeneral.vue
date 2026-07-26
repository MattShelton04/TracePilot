<script setup lang="ts">
import {
  clampSessionCacheSize,
  DEFAULT_CLI_COMMAND,
  DEFAULT_SESSION_CACHE_SIZE,
  MAX_SESSION_CACHE_SIZE,
  MIN_SESSION_CACHE_SIZE,
} from "@tracepilot/types";
import { ActionButton, BtnGroup, FormInput, FormSwitch, SectionPanel } from "@tracepilot/ui";
import { type ThemeOption, usePreferencesStore } from "@/stores/preferences";
import { useSessionsStore } from "@/stores/sessions";

const preferences = usePreferencesStore();
const sessionsStore = useSessionsStore();

const themeOptions = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function updateSessionCacheSize(value: unknown) {
  preferences.sessionCacheSize = clampSessionCacheSize(Number(value));
}
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
          aria-label="Hide empty sessions"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-label">Recent sessions kept ready</div>
          <div class="setting-description">
            Keeps this many non-empty recent sessions ready to open. RAM use varies with session
            size.
          </div>
        </div>
        <div class="setting-control-group">
          <ActionButton
            v-if="preferences.sessionCacheSize !== DEFAULT_SESSION_CACHE_SIZE"
            size="sm"
            @click="preferences.sessionCacheSize = DEFAULT_SESSION_CACHE_SIZE"
          >
            Reset
          </ActionButton>
          <FormInput
            :model-value="preferences.sessionCacheSize"
            @update:model-value="updateSessionCacheSize"
            type="number"
            :min="MIN_SESSION_CACHE_SIZE"
            :max="MAX_SESSION_CACHE_SIZE"
            step="1"
            class="input-narrow-center"
            aria-label="Recent sessions kept ready"
          />
        </div>
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
          :placeholder="DEFAULT_CLI_COMMAND"
          class="input-medium"
        />
      </div>
    </SectionPanel>
  </div>
</template>
