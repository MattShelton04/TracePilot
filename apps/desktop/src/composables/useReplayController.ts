/**
 * useReplayController — manages step-by-step playback state for Session Replay.
 *
 * Accepts a reactive list of ReplaySteps and provides transport controls
 * (play, pause, step, scrub, speed) with optional proportional timing.
 */
import { ref, computed, watch, onUnmounted, type Ref } from 'vue';
import type { ReplayStep } from '@tracepilot/types';
import { formatClockTime } from '@tracepilot/ui';

export interface ReplayControllerOptions {
  /** Use actual step durations (scaled by speed) instead of fixed interval. Default: false. */
  proportionalTiming?: boolean;
  /** Maximum wait between steps in proportional mode (ms). Default: 3000. */
  maxStepDelayMs?: number;
  /** Fixed interval between steps when not using proportional timing (ms). Default: 1500. */
  fixedIntervalMs?: number;
}

export function useReplayController(
  steps: Ref<ReplayStep[]>,
  options: ReplayControllerOptions = {},
) {
  const {
    proportionalTiming = false,
    maxStepDelayMs = 3000,
    fixedIntervalMs = 1500,
  } = options;

  const currentStep = ref(0);
  const isPlaying = ref(false);
  const speed = ref(1);
  let playTimer: ReturnType<typeof setTimeout> | null = null;

  const totalSteps = computed(() => steps.value.length);
  const currentStepData = computed(() => steps.value[currentStep.value] ?? null);

  const totalDurationMs = computed(() =>
    steps.value.reduce((sum, s) => sum + s.durationMs, 0),
  );

  const elapsedMs = computed(() =>
    steps.value.slice(0, currentStep.value + 1).reduce((sum, s) => sum + s.durationMs, 0),
  );

  const scrubberPercent = computed(() =>
    totalSteps.value > 1 ? (currentStep.value / (totalSteps.value - 1)) * 100 : 0,
  );

  const formattedElapsed = computed(() => formatClockTime(elapsedMs.value));
  const formattedTotal = computed(() => formatClockTime(totalDurationMs.value));

  // ── Timer management ──

  function clearTimer() {
    if (playTimer !== null) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  }

  function getStepDelay(): number {
    if (!proportionalTiming) return fixedIntervalMs / speed.value;
    const step = steps.value[currentStep.value];
    if (!step || step.durationMs <= 0) return 200 / speed.value;
    return Math.min(step.durationMs / speed.value, maxStepDelayMs / speed.value);
  }

  function scheduleNext() {
    clearTimer();
    if (currentStep.value >= totalSteps.value - 1) {
      isPlaying.value = false;
      return;
    }
    playTimer = setTimeout(() => {
      if (currentStep.value < totalSteps.value - 1) {
        currentStep.value++;
        scheduleNext();
      } else {
        isPlaying.value = false;
      }
    }, getStepDelay());
  }

  // ── Transport controls ──

  function play() {
    if (totalSteps.value === 0) return;
    if (currentStep.value >= totalSteps.value - 1) {
      currentStep.value = 0;
    }
    isPlaying.value = true;
    scheduleNext();
  }

  function pause() {
    isPlaying.value = false;
    clearTimer();
  }

  function togglePlayPause() {
    if (isPlaying.value) pause();
    else play();
  }

  function nextStep() {
    if (currentStep.value < totalSteps.value - 1) {
      currentStep.value++;
    }
  }

  function prevStep() {
    if (currentStep.value > 0) {
      currentStep.value--;
    }
  }

  function goToStep(n: number) {
    currentStep.value = Math.max(0, Math.min(n, totalSteps.value - 1));
  }

  function setSpeed(s: number) {
    speed.value = s;
    if (isPlaying.value) {
      scheduleNext();
    }
  }

  function restart() {
    currentStep.value = 0;
    if (!isPlaying.value) play();
    else scheduleNext();
  }

  // ── Scrubber interaction ──

  function scrubTo(percent: number) {
    const clamped = Math.max(0, Math.min(1, percent));
    goToStep(Math.round(clamped * (totalSteps.value - 1)));
  }

  function onScrubberClick(e: MouseEvent) {
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    scrubTo((e.clientX - rect.left) / rect.width);
  }

  // ── Keyboard shortcuts ──

  function handleKeydown(e: KeyboardEvent) {
    // Don't intercept when user is typing in an input/textarea
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextStep();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        prevStep();
        break;
      case 'Home':
        e.preventDefault();
        goToStep(0);
        break;
      case 'End':
        e.preventDefault();
        goToStep(totalSteps.value - 1);
        break;
      case '[':
        e.preventDefault();
        setSpeed(Math.max(0.5, speed.value / 2));
        break;
      case ']':
        e.preventDefault();
        setSpeed(Math.min(4, speed.value * 2));
        break;
    }
  }

  // ── Lifecycle ──

  // Reset playback when steps change (new session loaded)
  watch(steps, () => {
    pause();
    currentStep.value = 0;
  });

  onUnmounted(() => {
    clearTimer();
  });

  return {
    // State
    currentStep,
    isPlaying,
    speed,
    totalSteps,
    currentStepData,
    totalDurationMs,
    elapsedMs,
    scrubberPercent,
    formattedElapsed,
    formattedTotal,

    // Actions
    play,
    pause,
    togglePlayPause,
    nextStep,
    prevStep,
    goToStep,
    setSpeed,
    restart,
    scrubTo,
    onScrubberClick,
    handleKeydown,
    fmtTime: formatClockTime,
  };
}
