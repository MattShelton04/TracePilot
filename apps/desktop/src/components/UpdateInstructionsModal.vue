<script setup lang="ts">
import { computed } from 'vue';
import { useUpdateCheck } from '@/composables/useUpdateCheck';
import { openExternal } from '@/utils/openExternal';

const emit = defineEmits<{
  close: [];
}>();

const { updateResult } = useUpdateCheck();

const version = computed(() => updateResult.value?.latestVersion ?? '');
const releaseUrl = computed(() => updateResult.value?.releaseUrl);

function handleOpenRelease() {
  if (releaseUrl.value) {
    openExternal(releaseUrl.value);
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="emit('close')">
      <div class="modal-content" role="dialog" aria-labelledby="update-modal-title">
        <div class="modal-header">
          <h2 id="update-modal-title">Update to v{{ version }}</h2>
          <button class="modal-close" aria-label="Close" @click="emit('close')">×</button>
        </div>

        <div class="modal-body">
          <p class="update-intro">
            A new version of TracePilot is available. Choose how to update:
          </p>

          <div class="update-method">
            <h3 class="method-title">Option A: Source update (recommended)</h3>
            <div class="update-steps">
              <ol>
                <li>In your terminal, press <kbd>Ctrl+C</kbd> to stop TracePilot</li>
                <li>Navigate to your TracePilot directory</li>
                <li>
                  Pull the latest code:
                  <code>git pull</code>
                </li>
                <li>
                  Relaunch TracePilot:
                  <code>pnpm start</code>
                </li>
              </ol>
            </div>
          </div>

          <div class="update-method">
            <h3 class="method-title">Option B: Download installer</h3>
            <p class="method-description">
              Download the latest installer or standalone <code>.exe</code> from the
              <a
                v-if="releaseUrl"
                href="#"
                @click.prevent="handleOpenRelease"
              >GitHub Releases page</a><template v-else>GitHub Releases page</template>.
              Note: TracePilot is not code-signed (not worth the cost at this stage), so Windows may
              show a SmartScreen warning — click "More info" → "Run anyway" to proceed.
              Option A (build from source) is available if you prefer to avoid unsigned binaries.
            </p>
          </div>

          <div class="update-note">
            <strong>Note:</strong> If <code>git pull</code> fails due to conflicts,
            use <code>git stash</code> or <code>git reset --hard origin/main</code>
            (discards local changes) to resolve.
          </div>

          <div v-if="releaseUrl" class="update-links">
            <a href="#" @click.prevent="handleOpenRelease">
              View full release notes on GitHub →
            </a>
          </div>
        </div>

        <div class="modal-footer">
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
  background: var(--color-canvas-default, #1e1e2e);
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  max-width: 520px;
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
  color: var(--color-fg-default, #e2e8f0);
}

.modal-close {
  background: none;
  border: none;
  color: var(--color-fg-muted, #94a3b8);
  font-size: 22px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
}

.modal-close:hover {
  color: var(--color-fg-default, #e2e8f0);
}

.modal-body {
  padding: 4px 24px 20px;
}

.update-method {
  margin-bottom: 16px;
}

.method-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-fg-default, #e2e8f0);
  margin: 0 0 8px;
}

.method-description {
  font-size: 13px;
  color: var(--color-fg-muted, #94a3b8);
  line-height: 1.5;
}

.method-description a {
  color: var(--color-accent-fg, #818cf8);
  text-decoration: none;
}

.method-description a:hover {
  text-decoration: underline;
}

.method-description code {
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--color-accent-fg, #818cf8);
}

.update-intro {
  font-size: 14px;
  color: var(--color-fg-muted, #94a3b8);
  margin-bottom: 16px;
}

.update-steps ol {
  padding-left: 20px;
  font-size: 14px;
  line-height: 2;
  color: var(--color-fg-default, #e2e8f0);
}

.update-steps code {
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.04));
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  color: var(--color-accent-fg, #818cf8);
}

.update-steps kbd {
  background: var(--color-canvas-subtle, rgba(255, 255, 255, 0.08));
  padding: 1px 5px;
  border-radius: 3px;
  border: 1px solid var(--color-border-muted, rgba(255, 255, 255, 0.12));
  font-size: 12px;
  font-family: inherit;
}

.update-note {
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--color-attention-subtle, rgba(234, 179, 8, 0.08));
  border-radius: 8px;
  font-size: 13px;
  color: var(--color-fg-muted, #94a3b8);
  line-height: 1.5;
}

.update-note strong {
  color: var(--color-attention-fg, #eab308);
}

.update-note code {
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.update-links {
  margin-top: 14px;
}

.update-links a {
  color: var(--color-accent-fg, #818cf8);
  text-decoration: none;
  font-size: 13px;
}

.update-links a:hover {
  text-decoration: underline;
}

.modal-footer {
  padding: 12px 24px 20px;
  display: flex;
  justify-content: flex-end;
}

.modal-btn {
  padding: 8px 20px;
  border-radius: 8px;
  background: var(--color-accent-emphasis, #6366f1);
  color: #fff;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.modal-btn:hover {
  background: var(--color-accent-emphasis-hover, #4f46e5);
}
</style>
