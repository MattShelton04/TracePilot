import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import type { ReplayStep } from '@tracepilot/types';
import { useReplayController } from '../../composables/useReplayController';

// Mock onMounted/onUnmounted lifecycle hooks outside of components
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onMounted: vi.fn((fn) => fn()),
    onUnmounted: vi.fn(),
  };
});

function makeSteps(count: number): ReplayStep[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    turnIndex: i,
    title: `Step ${i}`,
    type: i % 2 === 0 ? 'user' as const : 'assistant' as const,
    timestamp: new Date(Date.now() + i * 5000).toISOString(),
    durationMs: 1000 + i * 500,
    tokens: 100 * (i + 1),
  }));
}

describe('useReplayController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes at step 0, not playing', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    expect(ctrl.currentStep.value).toBe(0);
    expect(ctrl.isPlaying.value).toBe(false);
    expect(ctrl.speed.value).toBe(1);
    expect(ctrl.totalSteps.value).toBe(5);
  });

  it('nextStep advances and prevStep retreats', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    ctrl.nextStep();
    expect(ctrl.currentStep.value).toBe(1);

    ctrl.nextStep();
    expect(ctrl.currentStep.value).toBe(2);

    ctrl.prevStep();
    expect(ctrl.currentStep.value).toBe(1);
  });

  it('prevStep does not go below 0', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    ctrl.prevStep();
    expect(ctrl.currentStep.value).toBe(0);
  });

  it('nextStep does not exceed last step', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    ctrl.goToStep(2);
    ctrl.nextStep();
    expect(ctrl.currentStep.value).toBe(2);
  });

  it('goToStep clamps to valid range', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    ctrl.goToStep(-1);
    expect(ctrl.currentStep.value).toBe(0);

    ctrl.goToStep(100);
    expect(ctrl.currentStep.value).toBe(4);
  });

  it('play/pause controls timer', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps, { fixedIntervalMs: 1000 });

    ctrl.play();
    expect(ctrl.isPlaying.value).toBe(true);

    // Advance 1 timer interval
    vi.advanceTimersByTime(1000);
    expect(ctrl.currentStep.value).toBe(1);

    ctrl.pause();
    expect(ctrl.isPlaying.value).toBe(false);

    // Timer should not advance after pause
    vi.advanceTimersByTime(3000);
    expect(ctrl.currentStep.value).toBe(1);
  });

  it('auto-pauses at end of steps', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps, { fixedIntervalMs: 1000 });

    ctrl.play();
    vi.advanceTimersByTime(1000); // step 1
    vi.advanceTimersByTime(1000); // step 2 (last)
    vi.advanceTimersByTime(1000); // should not advance further

    expect(ctrl.currentStep.value).toBe(2);
    expect(ctrl.isPlaying.value).toBe(false);
  });

  it('setSpeed changes playback rate', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps, { fixedIntervalMs: 2000 });

    ctrl.setSpeed(2);
    expect(ctrl.speed.value).toBe(2);

    ctrl.play();
    // At 2x speed, interval should be 1000ms (2000/2)
    vi.advanceTimersByTime(1000);
    expect(ctrl.currentStep.value).toBe(1);
  });

  it('restart goes to step 0 and plays', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    ctrl.goToStep(3);
    ctrl.restart();
    expect(ctrl.currentStep.value).toBe(0);
    expect(ctrl.isPlaying.value).toBe(true);
  });

  it('togglePlayPause toggles state', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    ctrl.togglePlayPause();
    expect(ctrl.isPlaying.value).toBe(true);

    ctrl.togglePlayPause();
    expect(ctrl.isPlaying.value).toBe(false);
  });

  it('computed properties update correctly', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    expect(ctrl.currentStepData.value).toEqual(steps.value[0]);

    ctrl.goToStep(1);
    expect(ctrl.currentStepData.value).toEqual(steps.value[1]);
  });

  it('totalDurationMs sums all step durations', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    const expected = steps.value.reduce((sum, s) => sum + s.durationMs, 0);
    expect(ctrl.totalDurationMs.value).toBe(expected);
  });

  it('elapsedMs sums durations up to current step', () => {
    const steps = ref(makeSteps(4));
    const ctrl = useReplayController(steps);

    ctrl.goToStep(2);
    const expected = steps.value.slice(0, 3).reduce((sum, s) => sum + s.durationMs, 0);
    expect(ctrl.elapsedMs.value).toBe(expected);
  });

  it('scrubberPercent is 0 at start and 100 at end', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    expect(ctrl.scrubberPercent.value).toBe(0);

    ctrl.goToStep(4);
    expect(ctrl.scrubberPercent.value).toBe(100);
  });

  it('handles empty steps gracefully', () => {
    const steps = ref<ReplayStep[]>([]);
    const ctrl = useReplayController(steps);

    expect(ctrl.currentStep.value).toBe(0);
    expect(ctrl.totalSteps.value).toBe(0);
    // currentStepData is null when no steps exist (computed from array index)
    expect(ctrl.currentStepData.value).toBeNull();
  });

  it('handleKeydown responds to Space for play/pause', () => {
    const steps = ref(makeSteps(3));
    const ctrl = useReplayController(steps);

    const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
    Object.defineProperty(spaceEvent, 'preventDefault', { value: vi.fn() });

    ctrl.handleKeydown(spaceEvent);
    expect(ctrl.isPlaying.value).toBe(true);

    ctrl.handleKeydown(spaceEvent);
    expect(ctrl.isPlaying.value).toBe(false);
  });

  it('handleKeydown responds to arrow keys', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    Object.defineProperty(rightEvent, 'preventDefault', { value: vi.fn() });
    ctrl.handleKeydown(rightEvent);
    expect(ctrl.currentStep.value).toBe(1);

    const leftEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' });
    Object.defineProperty(leftEvent, 'preventDefault', { value: vi.fn() });
    ctrl.handleKeydown(leftEvent);
    expect(ctrl.currentStep.value).toBe(0);
  });

  it('handleKeydown Home/End jump to boundaries', () => {
    const steps = ref(makeSteps(5));
    const ctrl = useReplayController(steps);

    const endEvent = new KeyboardEvent('keydown', { key: 'End' });
    Object.defineProperty(endEvent, 'preventDefault', { value: vi.fn() });
    ctrl.handleKeydown(endEvent);
    expect(ctrl.currentStep.value).toBe(4);

    const homeEvent = new KeyboardEvent('keydown', { key: 'Home' });
    Object.defineProperty(homeEvent, 'preventDefault', { value: vi.fn() });
    ctrl.handleKeydown(homeEvent);
    expect(ctrl.currentStep.value).toBe(0);
  });
});
