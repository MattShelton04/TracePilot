<script setup lang="ts">
import { getGitInfo } from '@tracepilot/client';
import type { GitInfo } from '@tracepilot/types';
import { SectionPanel } from '@tracepilot/ui';
import { onMounted, ref } from 'vue';
import LogoIcon from '@/components/icons/LogoIcon.vue';
import { useAppVersion } from '@/composables/useAppVersion';

defineProps<{
  sessionCount: number;
  databaseSize: string;
}>();

const { appVersion } = useAppVersion();
const gitInfo = ref<GitInfo | null>(null);

onMounted(async () => {
  try {
    gitInfo.value = await getGitInfo();
  } catch {
    /* ignore */
  }
});
</script>

<template>
  <div class="settings-section">
    <div class="settings-section-title">About</div>
    <SectionPanel>
      <div class="about-content">
        <div class="about-brand">
          <div class="about-brand-icon" aria-hidden="true">
            <LogoIcon :size="40" />
          </div>
          <div>
            <div class="about-app-name">TracePilot</div>
            <div class="about-tagline">
              Session analytics for AI-assisted development
            </div>
          </div>
        </div>

        <dl class="def-list about-meta">
          <dt>Version</dt>
          <dd>v{{ appVersion }}</dd>
          <template v-if="gitInfo?.commitHash">
            <dt>Commit</dt>
            <dd><code>{{ gitInfo.commitHash }}</code></dd>
          </template>
          <template v-if="gitInfo?.branch">
            <dt>Branch</dt>
            <dd>{{ gitInfo.branch }}</dd>
          </template>
          <dt>Session Count</dt>
          <dd class="tabular-nums">{{ sessionCount }}</dd>
          <dt>Database Size</dt>
          <dd class="tabular-nums">{{ databaseSize }}</dd>
        </dl>

        <div class="about-links">
          <a href="https://github.com/MattShelton04/TracePilot" target="_blank" rel="noopener">
            GitHub Repository
          </a>
          <a href="https://github.com/MattShelton04/TracePilot/wiki" target="_blank" rel="noopener">
            Documentation
          </a>
          <a href="https://github.com/MattShelton04/TracePilot/issues/new" target="_blank" rel="noopener">
            Report Issue
          </a>
        </div>

        <div class="about-footer">
          Built with Tauri, Rust &amp; Vue
        </div>
      </div>
    </SectionPanel>
  </div>
</template>

<style scoped>
.about-content {
  padding: 16px;
}

.about-brand {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}

.about-brand-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #6366f1, #818cf8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
}

.about-app-name {
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}

.about-tagline {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 2px;
}

.about-meta {
  margin-bottom: 16px;
}

.about-links {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.about-links a {
  color: var(--text-link);
  text-decoration: none;
  font-size: 0.8125rem;
  transition: color 100ms ease;
}

.about-links a:hover {
  color: var(--accent-fg);
  text-decoration: underline;
}

.about-footer {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
}
</style>
