<script setup lang="ts">
import type { ReleaseManifestEntry } from '@tracepilot/types';
import { computed } from 'vue';

const props = defineProps<{
  previousVersion: string;
  currentVersion: string;
  entries: ReleaseManifestEntry[];
  releaseUrl?: string;
}>();

const emit = defineEmits<{
  close: [];
  'open-external': [url: string];
}>();

/** Compare two semver strings numerically. Returns -1, 0, or 1. */
function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

/** Entries for versions between previous and current (inclusive of current). */
const relevantEntries = computed(() => {
  return props.entries.filter((entry) => {
    return (
      compareSemver(entry.version, props.previousVersion) > 0 &&
      compareSemver(entry.version, props.currentVersion) <= 0
    );
  });
});

const needsReindex = computed(() => relevantEntries.value.some((e) => e.requiresReindex));
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content" role="dialog" aria-labelledby="whats-new-title">
        <div class="modal-header">
          <h2 id="whats-new-title">🎉 What's New in v{{ currentVersion }}</h2>
          <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>
        </div>

        <div class="modal-body">
          <p v-if="previousVersion && previousVersion !== '0.0.0'" class="version-jump">
            Updated from v{{ previousVersion }}
          </p>

          <div
            v-for="entry in relevantEntries"
            :key="entry.version"
            class="version-section"
          >
            <h3 class="version-heading">
              v{{ entry.version }}
              <span class="version-date">{{ entry.date }}</span>
            </h3>

            <div v-if="entry.notes?.added?.length" class="change-group">
              <h4 class="change-group-title added-title">✨ Added</h4>
              <ul>
                <li v-for="item in entry.notes?.added" :key="item">{{ item }}</li>
              </ul>
            </div>

            <div v-if="entry.notes?.changed?.length" class="change-group">
              <h4 class="change-group-title changed-title">🔄 Changed</h4>
              <ul>
                <li v-for="item in entry.notes?.changed" :key="item">{{ item }}</li>
              </ul>
            </div>

            <div v-if="entry.notes?.fixed?.length" class="change-group">
              <h4 class="change-group-title fixed-title">🐛 Fixed</h4>
              <ul>
                <li v-for="item in entry.notes?.fixed" :key="item">{{ item }}</li>
              </ul>
            </div>

            <div v-if="entry.requiresReindex" class="reindex-notice">
              ⚠️ This version includes changes that benefit from a full reindex.
            </div>
          </div>

          <div v-if="relevantEntries.length === 0" class="no-notes">
            <p>No detailed release notes available for this update.</p>
            <p v-if="releaseUrl">
              <a
                href="#"
                class="release-notes-link"
                @click.prevent="emit('open-external', releaseUrl)"
              >
                View release notes on GitHub →
              </a>
            </p>
          </div>
        </div>

        <div class="modal-footer">
          <div v-if="needsReindex" class="reindex-footer-hint">
            💡 Consider running a full reindex from Settings to get the best experience.
          </div>
          <button class="modal-btn" @click="emit('close')">Got it</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--canvas-default);
  border: 1px solid var(--border-muted);
  border-radius: 12px;
  max-width: 560px;
  width: 90%;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 24px 16px;
}

.modal-header h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.modal-close {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 22px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 4px 24px 20px;
}

.version-jump {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border-muted);
}

.version-section {
  margin-bottom: 20px;
}

.version-section:last-child {
  margin-bottom: 0;
}

.version-heading {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 10px;
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.version-date {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.change-group {
  margin-bottom: 10px;
}

.change-group-title {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 4px;
}

.added-title { color: var(--success-fg); }
.changed-title { color: var(--accent-fg); }
.fixed-title { color: var(--attention-fg); }

.change-group ul {
  padding-left: 20px;
  margin: 0;
}

.change-group li {
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.7;
}

.reindex-notice {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--attention-subtle);
  border-radius: 8px;
  font-size: 13px;
  color: var(--attention-fg);
}

.no-notes {
  text-align: center;
  padding: 20px;
  color: var(--text-secondary);
  font-size: 14px;
}

.release-notes-link {
  color: var(--accent-fg);
  text-decoration: none;
  font-weight: 500;
}

.release-notes-link:hover {
  text-decoration: underline;
}

.modal-footer {
  padding: 12px 24px 20px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.reindex-footer-hint {
  flex: 1 1 100%;
  font-size: 12px;
  color: var(--attention-fg);
  margin-bottom: 4px;
}

.modal-btn {
  padding: 8px 20px;
  border-radius: 8px;
  background: var(--accent-emphasis);
  color: #fff;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.modal-btn:hover {
  background: var(--accent-emphasis-hover);
}

.modal-btn-secondary {
  background: transparent;
  border: 1px solid var(--border-muted);
  color: var(--text-primary);
}

.modal-btn-secondary:hover {
  background: var(--canvas-subtle);
}
</style>
