<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { getConfig, saveConfig, validateSessionDir, reindexSessions } from '@tracepilot/client';
import type { TracePilotConfig, ValidateSessionDirResult } from '@tracepilot/types';
import { FormSwitch } from '@tracepilot/ui';
import LogoIcon from '@/components/icons/LogoIcon.vue';

const emit = defineEmits<{ 'setup-complete': [] }>();

// ── Slide state ────────────────────────────────────────────────
const currentSlide = ref(0);
const totalSlides = 5;
const transitioning = ref(false);
const prefersReducedMotion = ref(false);

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

// ── Animation tracking ─────────────────────────────────────────
// Tracks which feature cards have finished their entrance animation
// so we can release the animation fill and allow hover transforms.
const animatedCards = ref(new Set<number>());

// ── Features list ──────────────────────────────────────────────
const features = [
  { emoji: '📋', color: '#818cf8', title: 'Session Explorer', desc: 'Browse and search all your Copilot coding sessions' },
  { emoji: '💬', color: '#34d399', title: 'Conversation Viewer', desc: 'Replay full AI conversations turn by turn' },
  { emoji: '📊', color: '#fbbf24', title: 'Analytics Dashboard', desc: 'Track token usage, costs, and productivity trends' },
  { emoji: '🔧', color: '#f472b6', title: 'Tool Analysis', desc: 'See which tools Copilot uses and how effectively' },
  { emoji: '📝', color: '#a78bfa', title: 'Code Impact', desc: 'Measure lines changed, files modified, and net impact' },
  { emoji: '💰', color: '#fb923c', title: 'Cost Tracking', desc: 'Monitor premium request spending and API cost estimates' },
];

// ── Computed ───────────────────────────────────────────────────
const canContinueSlide3 = computed(() => {
  if (!validationResult.value) return false;
  // Allow proceeding only when the path is valid (even with 0 sessions)
  return validationResult.value.valid;
});

const sessionCount = computed(() => validationResult.value?.sessionCount ?? 0);

const transitionDuration = computed(() => prefersReducedMotion.value ? '0ms' : '400ms');

// ── Navigation ─────────────────────────────────────────────────
const slidesViewport = ref<HTMLElement | null>(null);

function goTo(slide: number) {
  if (slide < 0 || slide >= totalSlides || transitioning.value) return;
  transitioning.value = true;
  currentSlide.value = slide;
  setTimeout(() => {
    transitioning.value = false;
    // Move focus to the new slide's first heading for keyboard accessibility
    nextTick(() => {
      const headings = slidesViewport.value?.querySelectorAll('.slide-content h1, .slide-content h2');
      const target = headings?.[slide] as HTMLElement | undefined;
      target?.focus({ preventScroll: true });
    });
  }, prefersReducedMotion.value ? 0 : 420);
}

function next() {
  if (currentSlide.value < totalSlides - 1) {
    goTo(currentSlide.value + 1);
  }
}

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
// Uses the tauri-plugin-dialog for native file explorer.
// Falls back to prompt() outside Tauri.
async function browseSessionDir() {
  if (!('__TAURI_INTERNALS__' in window)) {
    const input = prompt('Enter session-state directory path:', sessionDir.value);
    if (input) {
      sessionDir.value = input;
      await validateDir();
    }
    return;
  }
  try {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      title: 'Select session-state directory',
    });
    if (selected) {
      sessionDir.value = selected;
      await validateDir();
    }
  } catch {
    const input = prompt('Enter session-state directory path:', sessionDir.value);
    if (input) {
      sessionDir.value = input;
      await validateDir();
    }
  }
}

async function browseDbPath() {
  if (!('__TAURI_INTERNALS__' in window)) {
    const input = prompt('Enter database file path:', dbPath.value);
    if (input) dbPath.value = input;
    return;
  }
  try {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const selected = await save({
      title: 'Choose database location',
      defaultPath: dbPath.value,
    });
    if (selected) dbPath.value = selected;
  } catch {
    const input = prompt('Enter database file path:', dbPath.value);
    if (input) dbPath.value = input;
  }
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
      version: 1,
      paths: {
        sessionStateDir: sessionDir.value.trim(),
        indexDbPath: dbPath.value.trim(),
      },
      general: {
        autoIndexOnLaunch: autoIndex.value,
      },
    };
    await saveConfig(config);
    try {
      await reindexSessions();
    } catch {
      // Indexing failure is non-fatal — config is already saved
    }
    emit('setup-complete');
  } catch (e) {
    setupError.value = e instanceof Error ? e.message : String(e);
    console.error('Setup save failed:', e);
  } finally {
    saving.value = false;
  }
}

// ── Keyboard navigation ────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    next();
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentSlide.value > 0) goTo(currentSlide.value - 1);
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
    // Store backend defaults for the reset buttons
    defaultSessionDir.value = config.paths.sessionStateDir;
    defaultDbPath.value = config.paths.indexDbPath;
  } catch {
    // Defaults are fine (dev mode / outside Tauri)
  }

  // Auto-validate default path so user sees green tick immediately
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
        :style="{ transform: `translateX(-${currentSlide * 100}%)`, transitionDuration }"
      >
        <!-- ═══ Slide 1: Welcome ═══ -->
        <div class="slide">
          <div class="slide-content slide-welcome">
            <div class="logo-wrapper">
              <div class="logo-icon" aria-hidden="true">
                <LogoIcon :size="64" />
              </div>
            </div>
            <h1 class="welcome-title" tabindex="-1">TracePilot</h1>
            <p class="welcome-subtitle">Your personal Copilot analytics dashboard</p>
            <span class="version-pill">v0.1.0</span>
            <button class="btn-accent btn-lg" @click="next">Begin Setup →</button>
          </div>
        </div>

        <!-- ═══ Slide 2: Features ═══ -->
        <div class="slide">
          <div class="slide-content slide-features">
            <h2 class="slide-title" tabindex="-1">Powerful Analytics at Your Fingertips</h2>
            <div class="features-grid">
              <div
                v-for="(f, i) in features"
                :key="f.title"
                class="feature-card"
                :style="{ animationDelay: currentSlide === 1 ? `${i * 80}ms` : '0ms' }"
                :class="{ 'animate-in': currentSlide === 1 && !animatedCards.has(i), 'animate-done': animatedCards.has(i) }"
                @animationend="animatedCards.add(i)"
              >
                <div class="feature-icon" :style="{ background: f.color + '20', color: f.color }">
                  {{ f.emoji }}
                </div>
                <div class="feature-text">
                  <div class="feature-title">{{ f.title }}</div>
                  <div class="feature-desc">{{ f.desc }}</div>
                </div>
              </div>
            </div>
            <button class="btn-accent" @click="next">Continue →</button>
          </div>
        </div>

        <!-- ═══ Slide 3: Session Directory ═══ -->
        <div class="slide">
          <div class="slide-content slide-form">
            <div class="form-icon">📂</div>
            <h2 class="slide-title" tabindex="-1">Where are your sessions?</h2>
            <p class="slide-desc">
              GitHub Copilot stores session data in a local directory.
              TracePilot reads this data to generate analytics.
            </p>

            <div class="path-input-group">
              <input
                v-model="sessionDir"
                type="text"
                class="path-input"
                placeholder="~/.copilot/session-state"
                spellcheck="false"
                @blur="validateDir"
                @keydown.enter.prevent="validateDir"
              />
              <button class="btn-browse" @click="browseSessionDir">Browse…</button>
              <button
                v-if="sessionDir !== defaultSessionDir"
                class="btn-reset-path"
                title="Reset to default"
                aria-label="Reset session directory to default"
                @click="resetSessionDir"
              >↺</button>
            </div>

            <div class="validation-area">
              <div v-if="validating" class="validation-msg validating">
                <span class="spinner" />
                Checking directory…
              </div>
              <div v-else-if="validationError" class="validation-msg error">
                ✗ {{ validationError }}
              </div>
              <div v-else-if="validationResult?.valid && validationResult.sessionCount > 0" class="validation-msg success">
                ✓ Found {{ validationResult.sessionCount }} sessions
              </div>
              <div v-else-if="validationResult && validationResult.sessionCount === 0" class="validation-msg warning">
                ⚠ No sessions found yet — TracePilot will watch for new sessions
              </div>
            </div>

            <button
              class="btn-accent"
              :disabled="validating || !canContinueSlide3"
              @click="next"
            >
              Continue →
            </button>
          </div>
        </div>

        <!-- ═══ Slide 4: Database ═══ -->
        <div class="slide">
          <div class="slide-content slide-form">
            <div class="form-icon">🗄️</div>
            <h2 class="slide-title" tabindex="-1">Where should we store analytics?</h2>
            <p class="slide-desc">
              TracePilot creates a local search index for fast queries.
              Choose where to store the database file.
            </p>

            <div class="path-input-group">
              <input
                v-model="dbPath"
                type="text"
                class="path-input"
                placeholder="~/.copilot/tracepilot/index.db"
                spellcheck="false"
              />
              <button class="btn-browse" @click="browseDbPath">Browse…</button>
              <button
                v-if="dbPath !== defaultDbPath"
                class="btn-reset-path"
                title="Reset to default"
                aria-label="Reset database path to default"
                @click="resetDbPath"
              >↺</button>
            </div>

            <p class="form-note">~2 MB per 100 sessions. Will be created automatically.</p>

            <div class="toggle-row">
              <FormSwitch v-model="autoIndex" label="Auto-index sessions on launch" />
            </div>

            <button class="btn-accent" @click="next">Continue →</button>
          </div>
        </div>

        <!-- ═══ Slide 5: Ready ═══ -->
        <div class="slide">
          <div class="slide-content slide-ready">
            <div class="checkmark-wrapper" :class="{ 'animate-check': currentSlide === 4 }">
              <svg class="checkmark-svg" viewBox="0 0 52 52">
                <circle class="checkmark-circle" cx="26" cy="26" r="24" fill="none" stroke-width="2"/>
                <path class="checkmark-path" d="M15 26l7 7 15-15" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>

            <h2 class="slide-title" tabindex="-1">You're Ready!</h2>
            <p class="slide-desc">Here's a summary of your configuration</p>

            <div class="config-summary">
              <div class="summary-row">
                <span class="summary-icon">📂</span>
                <div class="summary-text">
                  <span class="summary-label">Sessions</span>
                  <span class="summary-value">{{ sessionDir }} — {{ sessionCount }} sessions</span>
                </div>
              </div>
              <div class="summary-row">
                <span class="summary-icon">🗄️</span>
                <div class="summary-text">
                  <span class="summary-label">Database</span>
                  <span class="summary-value">{{ dbPath }}</span>
                </div>
              </div>
              <div class="summary-row">
                <span class="summary-icon">⚡</span>
                <div class="summary-text">
                  <span class="summary-label">Auto-index</span>
                  <span class="summary-value">{{ autoIndex ? 'Enabled' : 'Disabled' }}</span>
                </div>
              </div>
            </div>

            <button class="btn-accent btn-lg btn-glow" :disabled="saving" @click="finishSetup">
              <span v-if="saving" class="btn-loading">
                <span class="spinner spinner-white" />
                Indexing sessions…
              </span>
              <span v-else>Launch TracePilot</span>
            </button>
            <p v-if="setupError" class="setup-error" role="alert">
              ⚠ Setup failed: {{ setupError }}. Please try again.
            </p>
            <p class="ready-footer">Change these anytime in Settings → Data &amp; Storage</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Dot navigation -->
    <div class="dot-nav" role="tablist" aria-label="Setup progress">
      <button
        v-for="i in totalSlides"
        :key="i"
        class="dot"
        :class="{ active: currentSlide === i - 1 }"
        role="tab"
        :aria-selected="currentSlide === i - 1"
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

.slide {
  min-width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.slide-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  max-width: 560px;
  width: 100%;
}

/* ── Slide 1: Welcome ─────────────────────────────────────── */
.logo-wrapper {
  margin-bottom: 8px;
}

.logo-icon {
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

.welcome-title {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #fafafa 0%, #a1a1aa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.welcome-subtitle {
  font-size: 20px;
  color: var(--text-secondary, #a1a1aa);
  margin-top: -4px;
}

.version-pill {
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
.slide-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  outline: none;
}

.features-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  width: 100%;
  margin: 8px 0;
}

.feature-card {
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

.feature-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

.feature-card.animate-in {
  animation: fadeInUp 400ms ease forwards;
}

/* After animation completes, set final state directly so hover transform works
   (animation fill-forwards blocks hover transforms per CSS spec) */
.feature-card.animate-done {
  opacity: 1;
  transform: translateY(0);
}

.feature-card.animate-done:hover {
  transform: translateY(-2px);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
  box-shadow: 0 4px 20px rgba(99, 102, 241, 0.10), 0 0 0 1px rgba(99, 102, 241, 0.08);
  background: var(--canvas-raised, #1c1c1f);
}

@keyframes fadeInUp {
  to { opacity: 1; transform: translateY(0); }
}

.feature-icon {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.feature-text {
  flex: 1;
  min-width: 0;
}

.feature-title {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary, #fafafa);
}

.feature-desc {
  font-size: 0.6875rem;
  color: var(--text-tertiary, #71717a);
  margin-top: 2px;
  line-height: 1.4;
}

/* ── Slide 3 & 4: Form slides ────────────────────────────── */
.form-icon {
  font-size: 48px;
  margin-bottom: 4px;
}

.slide-desc {
  font-size: 0.875rem;
  color: var(--text-secondary, #a1a1aa);
  line-height: 1.5;
  max-width: 440px;
}

.path-input-group {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 480px;
}

.path-input {
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

.path-input:focus {
  border-color: var(--accent-emphasis, #6366f1);
  box-shadow: 0 0 0 2px var(--accent-subtle, rgba(99, 102, 241, 0.10));
}

.btn-browse {
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

.btn-browse:hover {
  background: var(--canvas-raised, #1c1c1f);
  border-color: var(--border-accent, rgba(99, 102, 241, 0.5));
}

.btn-reset-path {
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

.btn-reset-path:hover {
  color: var(--warning-fg, #fbbf24);
  border-color: rgba(251, 191, 36, 0.4);
  background: rgba(251, 191, 36, 0.06);
}

/* ── Validation messages ──────────────────────────────────── */
.validation-area {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.validation-msg {
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 6px;
}

.validation-msg.success { color: var(--success-fg, #34d399); }
.validation-msg.warning { color: var(--warning-fg, #fbbf24); }
.validation-msg.error { color: var(--danger-fg, #fb7185); }
.validation-msg.validating { color: var(--text-tertiary, #71717a); }

.spinner {
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

.spinner-white {
  border-color: rgba(255,255,255,0.25);
  border-top-color: white;
}

.btn-loading {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.form-note {
  font-size: 0.75rem;
  color: var(--text-tertiary, #71717a);
  margin-top: -4px;
}

.toggle-row {
  margin: 4px 0;
}

/* ── Slide 5: Ready ───────────────────────────────────────── */
.checkmark-wrapper {
  width: 72px;
  height: 72px;
}

.checkmark-svg {
  width: 100%;
  height: 100%;
}

.checkmark-circle {
  stroke: var(--success-fg, #34d399);
  opacity: 0.2;
}

.checkmark-path {
  stroke: var(--success-fg, #34d399);
  stroke-dasharray: 48;
  stroke-dashoffset: 48;
}

.checkmark-wrapper.animate-check {
  animation: checkScale 500ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.checkmark-wrapper.animate-check .checkmark-path {
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

.config-summary {
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

.summary-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.summary-icon {
  font-size: 18px;
  line-height: 1.4;
}

.summary-text {
  display: flex;
  flex-direction: column;
  text-align: left;
}

.summary-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary, #71717a);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.summary-value {
  font-size: 0.8125rem;
  color: var(--text-secondary, #a1a1aa);
  font-family: 'JetBrains Mono', monospace;
  word-break: break-all;
}

.ready-footer {
  font-size: 0.75rem;
  color: var(--text-placeholder, #52525b);
}

.setup-error {
  color: var(--danger, #ef4444);
  font-size: 0.85rem;
  font-weight: 500;
  margin: 0.5rem 0;
}

/* ── Buttons ──────────────────────────────────────────────── */
.btn-accent {
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

.btn-accent:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-accent:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-lg {
  padding: 14px 36px;
  font-size: 1rem;
}

.btn-glow {
  box-shadow: 0 0 30px rgba(99, 102, 241, 0.25);
}

.btn-glow:hover:not(:disabled) {
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
  .logo-icon { animation: none; }
  .feature-card { opacity: 1; transform: none; animation: none !important; }
  .checkmark-wrapper.animate-check { animation: none; transform: scale(1); }
  .checkmark-wrapper.animate-check .checkmark-path { animation: none; stroke-dashoffset: 0; }
  .slides-track { transition-duration: 0ms !important; }
}
</style>
