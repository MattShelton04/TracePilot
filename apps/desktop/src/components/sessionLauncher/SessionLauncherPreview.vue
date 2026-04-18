<script setup lang="ts">
import { truncateText } from "@tracepilot/ui";
import { useSessionLauncherContext } from "@/composables/useSessionLauncher";

const {
  store,
  repoPath,
  branch,
  prompt,
  reasoningEffort,
  autoApprove,
  createWorktree,
  headless,
  estimatedCost,
  selectedModelInfo,
  selectedTemplateName,
  cliCommandParts,
  canLaunch,
  handleLaunch,
  copyCommand,
  tierLabel,
} = useSessionLauncherContext();
</script>

<template>
  <aside class="panel-right">
    <div class="preview-inner">
      <div class="preview-header">Live Preview</div>

      <div class="preview-body">
        <div class="meta-grid">
          <div class="meta-card">
            <span class="meta-label">Est. Cost</span>
            <span class="meta-value accent">{{ estimatedCost }}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Model Tier</span>
            <span class="meta-value">{{ selectedModelInfo ? tierLabel(selectedModelInfo.tier) : 'Default' }}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Active Sessions</span>
            <span class="meta-value success">{{ store.recentLaunches.length }}</span>
          </div>
          <div class="meta-card">
            <span class="meta-label">Template</span>
            <span class="meta-value">{{ selectedTemplateName }}</span>
          </div>
        </div>

        <div class="config-summary">
          <div class="config-row">
            <span class="config-key">Template</span>
            <span class="config-val">{{ selectedTemplateName }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Repository</span>
            <span class="config-val">{{ repoPath || '—' }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Branch</span>
            <span class="config-val">{{ branch || 'default' }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Model</span>
            <span class="config-val">{{ selectedModelInfo?.name ?? 'Default' }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Reasoning</span>
            <span class="config-val">{{ tierLabel(reasoningEffort) }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Auto-approve</span>
            <span class="config-val">{{ autoApprove ? '✅' : '❌' }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Worktree</span>
            <span class="config-val">{{ createWorktree ? '✅' : '❌' }}</span>
          </div>
          <div class="config-row">
            <span class="config-key">Headless</span>
            <span class="config-val">{{ headless ? '✅' : '❌' }}</span>
          </div>
          <div class="config-row" v-if="prompt">
            <span class="config-key">Prompt</span>
            <span class="config-val">{{ truncateText(prompt, 40) }} <span style="opacity:0.6; font-size: 0.7rem">(--interactive)</span></span>
          </div>
        </div>

        <div class="preview-divider" />

        <div class="cmd-section">
          <div class="cmd-header">
            <span class="cmd-title">Command Preview</span>
            <button class="cmd-copy" @click="copyCommand">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25ZM5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
              Copy
            </button>
          </div>
          <pre class="cmd-block"><code><template v-for="(part, i) in cliCommandParts" :key="i">{{ i > 0 ? ' \\\n  ' : '' }}<span class="cmd-flag">{{ part.flag }}</span><template v-if="part.value"> <span class="cmd-val">{{ part.value }}</span></template></template></code></pre>
        </div>
      </div>

      <div class="preview-footer">
        <button class="btn btn-secondary footer-btn" :disabled="true" title="Coming Soon…" style="opacity: 0.5; cursor: not-allowed;">
          Launch Headless
        </button>
        <button class="btn btn-primary footer-btn-primary" @click="handleLaunch(false)" :disabled="!canLaunch">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="margin-right: 6px"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm4.879-2.773 4.264 2.559a.25.25 0 0 1 0 .428l-4.264 2.559A.25.25 0 0 1 6 10.559V5.442a.25.25 0 0 1 .379-.215Z"/></svg>
          {{ store.loading ? 'Launching…' : 'Launch Session' }}
        </button>
      </div>
    </div>
  </aside>
</template>
