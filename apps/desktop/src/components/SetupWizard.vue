<script setup lang="ts">
import { getConfig, saveConfig, validateSessionDir } from '@tracepilot/client';
import type { TracePilotConfig, ValidateSessionDirResult } from '@tracepilot/types';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import WizardStepDatabase from '@/components/wizard/WizardStepDatabase.vue';
import WizardStepFeatures from '@/components/wizard/WizardStepFeatures.vue';
import WizardStepReady from '@/components/wizard/WizardStepReady.vue';
import WizardStepSessionDir from '@/components/wizard/WizardStepSessionDir.vue';
import WizardStepWelcome from '@/components/wizard/WizardStepWelcome.vue';
import { useAppVersion } from '@/composables/useAppVersion';
import { browseForDirectory, browseForSavePath } from '@/composables/useBrowseDirectory';
import { useWizardNavigation } from '@/composables/useWizardNavigation';

const { appVersion } = useAppVersion();

const emit = defineEmits<{
  'setup-complete': [];
  'setup-saved': [sessionCount: number];
}>();

// ── Navigation ─────────────────────────────────────────────────
const prefersReducedMotion = ref(false);
const slidesViewport = ref<HTMLElement | null>(null);
const TOTAL_SLIDES = 5;

const { currentStep, transitionDuration, goTo, next, onKeydown } = useWizardNavigation({
  totalSteps: TOTAL_SLIDES,
  prefersReducedMotion,
  slidesViewport,
});

// ── Form state ─────────────────────────────────────────────────
// Fallback defaults for dev mode (outside Tauri). In production the backend
// returns absolute paths via getConfig() which replace these on mount.
const FALLBACK_SESSION_DIR = '~/.copilot/session-state';
const FALLBACK_DB_PATH = '~/.copilot/tracepilot/index.db';

const defaultSessionDir = ref(FALLBACK_SESSION_DIR);
const defaultDbPath = ref(FALLBACK_DB_PATH);

const sessionDir = ref(FALLBACK_SESSION_DIR);
const dbPath = ref(FALLBACK_DB_PATH);
const autoIndex = ref(true);

// ── Validation state ───────────────────────────────────────────
const validating = ref(false);
const validationResult = ref<ValidateSessionDirResult | null>(null);
const validationError = ref('');

// ── Saving state ───────────────────────────────────────────────
const saving = ref(false);

// ── Computed ───────────────────────────────────────────────────
const canContinueSlide3 = computed(() => {
  if (!validationResult.value) return false;
  return validationResult.value.valid;
});

const sessionCount = computed(() => validationResult.value?.sessionCount ?? 0);

// ── Validation ─────────────────────────────────────────────────
async function validateDir() {
  if (!sessionDir.value.trim()) return;
  validating.value = true;
  validationResult.value = null;
  validationError.value = '';
  try {
    const result = await validateSessionDir(sessionDir.value.trim());
    validationResult.value = result;
    if (!result.valid && result.error) {
      validationError.value = result.error;
    }
  } catch (e) {
    validationError.value = e instanceof Error ? e.message : String(e);
  } finally {
    validating.value = false;
  }
}

// ── Browse (Tauri dialog) ──────────────────────────────────────
async function browseSessionDir() {
  const selected = await browseForDirectory({
    title: 'Select session-state directory',
    defaultPath: sessionDir.value,
  });
  if (selected) {
    sessionDir.value = selected;
    await validateDir();
  }
}

async function browseDbPath() {
  const selected = await browseForSavePath({
    title: 'Choose database location',
    defaultPath: dbPath.value,
  });
  if (selected) dbPath.value = selected;
}

// ── Skip setup ─────────────────────────────────────────────────
async function skipSetup() {
  await finishSetup();
}

// ── Reset to defaults ──────────────────────────────────────────
function resetSessionDir() {
  sessionDir.value = defaultSessionDir.value;
  validationResult.value = null;
  validationError.value = '';
  validateDir();
}

function resetDbPath() {
  dbPath.value = defaultDbPath.value;
}

// ── Finish setup ───────────────────────────────────────────────
const setupError = ref('');

async function finishSetup() {
  saving.value = true;
  setupError.value = '';
  try {
    const config: TracePilotConfig = {
      version: 2,
      paths: {
        sessionStateDir: sessionDir.value.trim(),
        indexDbPath: dbPath.value.trim(),
      },
      general: {
        autoIndexOnLaunch: autoIndex.value,
        cliCommand: 'copilot',
      },
      ui: {
        theme: 'dark',
        hideEmptySessions: true,
        autoRefreshEnabled: false,
        autoRefreshIntervalSeconds: 5,
        checkForUpdates: false,
        favouriteModels: ['claude-opus-4.6', 'gpt-5.4', 'gpt-5.3-codex'],
        recentRepoPaths: [],
      },
      pricing: {
        costPerPremiumRequest: 0.04,
        models: [],
      },
      toolRendering: {
        enabled: true,
        toolOverrides: {},
      },
      features: {
        exportView: false,
        healthScoring: false,
        sessionReplay: false,
      },
    };
    await saveConfig(config);
    emit('setup-saved', validationResult.value?.sessionCount ?? 0);
  } catch (e) {
    setupError.value = e instanceof Error ? e.message : String(e);
    console.error('Setup save failed:', e);
  } finally {
    saving.value = false;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────
onMounted(async () => {
  prefersReducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.addEventListener('keydown', onKeydown);

  try {
    const config = await getConfig();
    sessionDir.value = config.paths.sessionStateDir;
    dbPath.value = config.paths.indexDbPath;
    autoIndex.value = config.general.autoIndexOnLaunch;
    defaultSessionDir.value = config.paths.sessionStateDir;
    defaultDbPath.value = config.paths.indexDbPath;
  } catch {
    // Defaults are fine (dev mode / outside Tauri)
  }

  await nextTick();
  validateDir();
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div class="setup-overlay" role="dialog" aria-label="Setup Wizard">
    <!-- Ambient background -->
    <div class="setup-bg">
      <div class="dot-grid" />
      <div class="orb orb-1" />
      <div class="orb orb-2" />
    </div>

    <!-- Skip link -->
    <button class="skip-link" :disabled="saving" @click="skipSetup">
      {{ saving ? 'Setting up…' : 'Skip setup' }}
    </button>

    <!-- Slide container -->
    <div ref="slidesViewport" class="slides-viewport">
      <div
        class="slides-track"
        :style="{ transform: `translateX(-${currentStep * 100}%)`, transitionDuration }"
      >
        <WizardStepWelcome :app-version="appVersion" @next="next" />

        <WizardStepFeatures :active="currentStep === 1" @next="next" />

        <WizardStepSessionDir
          :session-dir="sessionDir"
          :default-session-dir="defaultSessionDir"
          :validating="validating"
          :validation-result="validationResult"
          :validation-error="validationError"
          :can-continue="canContinueSlide3"
          @next="next"
          @update:session-dir="sessionDir = $event"
          @validate="validateDir"
          @browse="browseSessionDir"
          @reset="resetSessionDir"
        />

        <WizardStepDatabase
          :db-path="dbPath"
          :default-db-path="defaultDbPath"
          :auto-index="autoIndex"
          @next="next"
          @update:db-path="dbPath = $event"
          @update:auto-index="autoIndex = $event"
          @browse="browseDbPath"
          @reset="resetDbPath"
        />

        <WizardStepReady
          :active="currentStep === 4"
          :session-dir="sessionDir"
          :db-path="dbPath"
          :auto-index="autoIndex"
          :session-count="sessionCount"
          :saving="saving"
          :setup-error="setupError"
          @finish="finishSetup"
        />
      </div>
    </div>

    <!-- Dot navigation -->
    <div class="dot-nav" role="tablist" aria-label="Setup progress">
      <button
        v-for="i in TOTAL_SLIDES"
        :key="i"
        class="dot"
        :class="{ active: currentStep === i - 1 }"
        role="tab"
        :aria-selected="currentStep === i - 1"
        :aria-label="`Step ${i}`"
        @click="goTo(i - 1)"
      />
    </div>
  </div>
</template>

<style scoped>
/* ── Overlay ──────────────────────────────────────────────── */
.setup-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--canvas-default, #09090b);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-family: var(--font-family, 'Inter Variable', sans-serif);
  color: var(--text-primary, #fafafa);
}

/* ── Background effects ───────────────────────────────────── */
.setup-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.dot-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 24px 24px;
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.12;
}

.orb-1 {
  width: 500px;
  height: 500px;
  background: #6366f1;
  top: -150px;
  right: -100px;
}

.orb-2 {
  width: 400px;
  height: 400px;
  background: #8b5cf6;
  bottom: -120px;
  left: -80px;
}

/* ── Skip link ────────────────────────────────────────────── */
.skip-link {
  position: absolute;
  top: 20px;
  right: 24px;
  z-index: 10;
  background: none;
  border: none;
  color: var(--text-tertiary, #71717a);
  font-size: 0.8125rem;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: var(--radius-md, 8px);
  transition: color 180ms ease, background 180ms ease;
}

.skip-link:hover {
  color: var(--text-secondary, #a1a1aa);
  background: rgba(255,255,255,0.04);
}

/* ── Slides viewport ──────────────────────────────────────── */
.slides-viewport {
  width: 100%;
  max-width: 720px;
  overflow: hidden;
  flex: 1;
  display: flex;
  align-items: center;
}

.slides-track {
  display: flex;
  width: 100%;
  transition: transform 400ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* ── Shared step styles (applied into child components) ───── */
:deep(.slide) {
  min-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

:deep(.slide-content) {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  max-width: 560px;
  width: 100%;
}

/* ── Slide 1: Welcome ─────────────────────────────────────── */
:deep(.logo-wrapper) {
  margin-bottom: 8px;
}

:deep(.logo-icon) {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  background: var(--gradient-accent, linear-gradient(135deg, #6366f1, #8b5cf6));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 0 40px rgba(99, 102, 241, 0.3);
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 40px rgba(99, 102, 241, 0.3); }
  50% { box-shadow: 0 0 60px rgba(99, 102, 241, 0.45); }
}

:deep(.welcome-title) {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #fafafa 0%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

:deep(.welcome-subtitle) {
  font-size: 20px;
  color: var(--text-secondary, #a1a1aa);
  margin-top: -4px;
}

:deep(.version-pill) {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 9999px;
  background: var(--accent-subtle, rgba(99, 102, 241, 0.10));
  color: var(--accent-fg, #818cf8);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

/* ── Slide 2: Features ────────────────────────────────────── */
:deep(.slide-title) {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  outline: none;
}

:deep(.features-grid) {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin: 8px 0;
}

:deep(.feature-card) {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-lg, 10px);
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-muted, rgba(255,255,255,0.06));
  text-align: left;
  opacity: 0;
  transform: translateY(12px);
  transition: transform 220ms ease, border-color 220ms ease, box-shadow 220ms ease, background 220ms ease;
  cursor: default;
}

:deep(.feature-card:hover) {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

:deep(.feature-card.animate-in) {
  animation: fadeInUp 400ms ease forwards;
}

/* After animation completes, set final state directly so hover transform works
   (animation fill-forwards blocks hover transforms per CSS spec) */
:deep(.feature-card.animate-done) {
  opacity: 1;
  transform: translateY(0);
}

:deep(.feature-card.animate-done:hover) {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

@keyframes fadeInUp {
  to { opacity: 1; transform: translateY(0); }
}

:deep(.feature-icon) {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

:deep(.feature-text) {
  flex: 1;
  min-width: 0;
}

:deep(.feature-title) {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #fafafa);
}

:deep(.feature-desc) {
  font-size: 0.6875rem;
  color: var(--text-tertiary, #71717a);
  margin-top: 2px;
  line-height: 1.4;
}

/* ── Slide 3 & 4: Form slides ────────────────────────────── */
:deep(.form-icon) {
  font-size: 48px;
  margin-bottom: 4px;
}

:deep(.slide-desc) {
  font-size: 0.875rem;
  color: var(--text-secondary, #a1a1aa);
  line-height: 1.5;
  max-width: 440px;
}

:deep(.path-input-group) {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 480px;
}

:deep(.path-input) {
  flex: 1;
  padding: 10px 14px;
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-default, rgba(255,255,255,0.10));
  border-radius: var(--radius-md, 8px);
  color: var(--text-primary, #fafafa);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.8125rem;
  outline: none;
  transition: border-color 180ms ease;
}

:deep(.path-input:focus) {
  border-color: var(--accent-emphasis, #6366f1);
  box-shadow: 0 0 0 2px var(--accent-subtle, rgba(99, 102, 241, 0.10));
}

:deep(.btn-browse) {
  padding: 10px 16px;
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-default, rgba(255,255,255,0.10));
  border-radius: var(--radius-md, 8px);
  color: var(--text-secondary, #a1a1aa);
  font-size: 0.8125rem;
  cursor: pointer;
  white-space: nowrap;
  transition: background 180ms ease, border-color 180ms ease;
}

:deep(.btn-browse:hover) {
  background: var(--canvas-raised, #1c1c1f);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
}

:deep(.btn-reset-path) {
  padding: 10px 12px;
  background: none;
  border: 1px solid var(--border-default, rgba(255,255,255,0.10));
  border-radius: var(--radius-md, 8px);
  color: var(--text-tertiary, #71717a);
  font-size: 1rem;
  cursor: pointer;
  transition: color 180ms ease, border-color 180ms ease, background 180ms ease;
  line-height: 1;
}

:deep(.btn-reset-path:hover) {
  color: var(--warning-fg, #fbbf24);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.06);
}

/* ── Validation messages ──────────────────────────────────── */
:deep(.validation-area) {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

:deep(.validation-msg) {
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

:deep(.validation-msg.success) { color: var(--success-fg, #34d399); }
:deep(.validation-msg.warning) { color: var(--warning-fg, #fbbf24); }
:deep(.validation-msg.error) { color: var(--danger-fg, #fb7185); }
:deep(.validation-msg.validating) { color: var(--text-tertiary, #71717a); }

:deep(.spinner) {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-default, rgba(255,255,255,0.10));
  border-top-color: var(--accent-fg, #818cf8);
  border-radius: 50%;
  animation: spin 600ms linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

:deep(.spinner-white) {
  border-color: rgba(255,255,255,0.25);
  border-top-color: white;
}

:deep(.btn-loading) {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

:deep(.form-note) {
  font-size: 0.75rem;
  color: var(--text-tertiary, #71717a);
  margin-top: -4px;
}

:deep(.toggle-row) {
  margin: 4px 0;
}

/* ── Slide 5: Ready ───────────────────────────────────────── */
:deep(.checkmark-wrapper) {
  width: 72px;
  height: 72px;
}

:deep(.checkmark-svg) {
  width: 100%;
  height: 100%;
}

:deep(.checkmark-circle) {
  stroke: var(--success-fg, #34d399);
  opacity: 0.2;
}

:deep(.checkmark-path) {
  stroke: var(--success-fg, #34d399);
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
}

:deep(.checkmark-wrapper.animate-check) {
  animation: checkScale 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

:deep(.checkmark-wrapper.animate-check .checkmark-path) {
  animation: checkDraw 500ms 300ms ease forwards;
}

@keyframes checkScale {
  0% { transform: scale(0); }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

@keyframes checkDraw {
  to { stroke-dashoffset: 0; }
}

:deep(.config-summary) {
  width: 100%;
  max-width: 440px;
  background: var(--canvas-subtle, #111113);
  border: 1px solid var(--border-muted, rgba(255,255,255,0.06));
  border-radius: var(--radius-lg, 10px);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

:deep(.summary-row) {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

:deep(.summary-icon) {
  font-size: 18px;
  line-height: 1.4;
}

:deep(.summary-text) {
  display: flex;
  flex-direction: column;
  text-align: left;
}

:deep(.summary-label) {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary, #71717a);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

:deep(.summary-value) {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a1a1aa);
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

:deep(.ready-footer) {
  font-size: 0.75rem;
  color: var(--text-placeholder, #52525b);
}

:deep(.setup-error) {
  color: var(--danger, #ef4444);
  font-size: 0.85rem;
  font-weight: 500;
  margin: 0.5rem 0;
}

/* ── Buttons (shared across steps) ────────────────────────── */
:deep(.btn-accent) {
  padding: 10px 28px;
  background: var(--accent-emphasis, #6366f1);
  color: white;
  border: none;
  border-radius: var(--radius-md, 8px);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 180ms ease, opacity 180ms ease, box-shadow 180ms ease;
}

:deep(.btn-accent:hover:not(:disabled)) {
  background: #4f46e5;
}

:deep(.btn-accent:disabled) {
  opacity: 0.4;
  cursor: not-allowed;
}

:deep(.btn-lg) {
  padding: 14px 36px;
  font-size: 1rem;
}

:deep(.btn-glow) {
  box-shadow: 0 0 30px rgba(99, 102, 241, 0.25);
}

:deep(.btn-glow:hover:not(:disabled)) {
  box-shadow: 0 0 40px rgba(99, 102, 241, 0.4);
}

/* ── Dot navigation ───────────────────────────────────────── */
.dot-nav {
  display: flex;
  gap: 10px;
  padding: 24px;
  z-index: 2;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border-default, rgba(255,255,255,0.10));
  border: none;
  padding: 0;
  cursor: pointer;
  transition: background 200ms ease, transform 200ms ease;
}

.dot.active {
  background: var(--accent-emphasis, #6366f1);
  transform: scale(1.3);
}

.dot:hover:not(.active) {
  background: var(--text-tertiary, #71717a);
}

/* ── Reduced motion ───────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  :deep(.logo-icon) { animation: none; }
  :deep(.feature-card) { opacity: 1; transform: none; animation: none !important; }
  :deep(.checkmark-wrapper.animate-check) { animation: none; transform: scale(1); }
  :deep(.checkmark-wrapper.animate-check .checkmark-path) { animation: none; stroke-dashoffset: 0; }
  .slides-track { transition-duration: 0ms !important; }
}
</style>
