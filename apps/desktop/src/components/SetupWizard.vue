<script setup lang="ts">
import {
  getConfig,
  saveConfig,
  type ValidateSessionDirResult,
  validateSessionDir,
} from "@tracepilot/client";
import type { TracePilotConfig } from "@tracepilot/types";
import {
  COPILOT_HOME_PLACEHOLDER,
  COPILOT_SESSION_STATE_DIR_PLACEHOLDER,
  createDefaultConfig,
  deriveIndexDbPath,
  deriveSessionStateDir,
  TRACEPILOT_HOME_PLACEHOLDER,
  TRACEPILOT_INDEX_DB_PLACEHOLDER,
} from "@tracepilot/types";
import { toErrorMessage, useKeydown } from "@tracepilot/ui";
import { computed, nextTick, onMounted, ref } from "vue";
import WizardStepDatabase from "@/components/wizard/WizardStepDatabase.vue";
import WizardStepFeatures from "@/components/wizard/WizardStepFeatures.vue";
import WizardStepReady from "@/components/wizard/WizardStepReady.vue";
import WizardStepSessionDir from "@/components/wizard/WizardStepSessionDir.vue";
import WizardStepWelcome from "@/components/wizard/WizardStepWelcome.vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { browseForDirectory } from "@/composables/useBrowseDirectory";
import { useWizardNavigation } from "@/composables/useWizardNavigation";
import { logError } from "@/utils/logger";

const { appVersion } = useAppVersion();

const emit = defineEmits<{
  "setup-complete": [];
  "setup-saved": [sessionCount: number];
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
const FALLBACK_SESSION_DIR = COPILOT_SESSION_STATE_DIR_PLACEHOLDER;
const FALLBACK_COPILOT_HOME = COPILOT_HOME_PLACEHOLDER;
const FALLBACK_TRACEPILOT_HOME = TRACEPILOT_HOME_PLACEHOLDER;
const FALLBACK_DB_PATH = TRACEPILOT_INDEX_DB_PLACEHOLDER;

const defaultSessionDir = ref(FALLBACK_SESSION_DIR);
const defaultCopilotHome = ref(FALLBACK_COPILOT_HOME);
const defaultTracePilotHome = ref(FALLBACK_TRACEPILOT_HOME);

const copilotHome = ref(FALLBACK_COPILOT_HOME);
const sessionDir = computed(() => deriveSessionStateDir(copilotHome.value) || FALLBACK_SESSION_DIR);
const tracepilotHome = ref(FALLBACK_TRACEPILOT_HOME);
const dbPath = computed(() => deriveIndexDbPath(tracepilotHome.value) || FALLBACK_DB_PATH);

// ── Validation state ───────────────────────────────────────────
const validating = ref(false);
const validationResult = ref<ValidateSessionDirResult | null>(null);
const validationError = ref("");

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
  validationError.value = "";
  try {
    const result = await validateSessionDir(sessionDir.value.trim());
    validationResult.value = result;
    if (!result.valid && result.error) {
      validationError.value = result.error;
    }
  } catch (e) {
    validationError.value = toErrorMessage(e);
  } finally {
    validating.value = false;
  }
}

// ── Browse (Tauri dialog) ──────────────────────────────────────
async function browseCopilotHome() {
  const selected = await browseForDirectory({
    title: "Select Copilot home directory",
    defaultPath: copilotHome.value,
  });
  if (selected) {
    copilotHome.value = selected;
    await validateDir();
  }
}

async function browseDbPath() {
  const selected = await browseForDirectory({
    title: "Choose TracePilot data directory",
    defaultPath: tracepilotHome.value,
  });
  if (selected) tracepilotHome.value = selected;
}

// ── Skip setup ─────────────────────────────────────────────────
async function skipSetup() {
  await finishSetup();
}

// ── Reset to defaults ──────────────────────────────────────────
function resetSessionDir() {
  copilotHome.value = defaultCopilotHome.value;
  validationResult.value = null;
  validationError.value = "";
  validateDir();
}

function resetDbPath() {
  tracepilotHome.value = defaultTracePilotHome.value;
}

// ── Finish setup ───────────────────────────────────────────────
const setupError = ref("");

async function finishSetup() {
  saving.value = true;
  setupError.value = "";
  try {
    const config: TracePilotConfig = createDefaultConfig({
      paths: {
        copilotHome: copilotHome.value.trim(),
        sessionStateDir: sessionDir.value.trim(),
        tracepilotHome: tracepilotHome.value.trim(),
        indexDbPath: dbPath.value,
      },
      general: {
        autoIndexOnLaunch: true,
      },
    });
    await saveConfig(config);
    emit("setup-saved", validationResult.value?.sessionCount ?? 0);
  } catch (e) {
    setupError.value = toErrorMessage(e);
    logError("[setup] Setup save failed:", e);
  } finally {
    saving.value = false;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────
useKeydown(onKeydown, { target: document });

onMounted(async () => {
  prefersReducedMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  try {
    const config = await getConfig();
    copilotHome.value = config.paths.copilotHome;
    tracepilotHome.value = config.paths.tracepilotHome;
    defaultSessionDir.value = config.paths.sessionStateDir;
    defaultCopilotHome.value = config.paths.copilotHome;
    defaultTracePilotHome.value = config.paths.tracepilotHome;
  } catch {
    // Defaults are fine (dev mode / outside Tauri)
  }

  await nextTick();
  validateDir();
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
          :copilot-home="copilotHome"
          :session-dir="sessionDir"
          :default-copilot-home="defaultCopilotHome"
          :default-session-dir="defaultSessionDir"
          :validating="validating"
          :validation-result="validationResult"
          :validation-error="validationError"
          :can-continue="canContinueSlide3"
          @next="next"
          @update:copilot-home="copilotHome = $event"
          @validate="validateDir"
          @browse="browseCopilotHome"
          @reset="resetSessionDir"
        />

        <WizardStepDatabase
          :tracepilot-home="tracepilotHome"
          :db-path="dbPath"
          :default-tracepilot-home="defaultTracePilotHome"
          @next="next"
          @update:tracepilot-home="tracepilotHome = $event"
          @browse="browseDbPath"
          @reset="resetDbPath"
        />

        <WizardStepReady
          :active="currentStep === 4"
          :session-dir="sessionDir"
          :db-path="dbPath"
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
  background: var(--accent-emphasis);
  top: -150px;
  right: -100px;
}

.orb-2 {
  width: 400px;
  height: 400px;
  background: var(--done-emphasis);
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
  background: var(--accent-emphasis);
  transform: scale(1.3);
}

.dot:hover:not(.active) {
  background: var(--text-tertiary, #71717a);
}

/* ── Reduced motion ───────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  .slides-track { transition-duration: 0ms !important; }
}
</style>
