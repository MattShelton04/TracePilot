import { type Ref, computed, nextTick, ref } from 'vue';

export interface WizardNavigationOptions {
  totalSteps: number;
  prefersReducedMotion: Ref<boolean>;
  slidesViewport: Ref<HTMLElement | null>;
}

/**
 * Composable for wizard slide navigation with keyboard support,
 * transition guards, and focus management.
 */
export function useWizardNavigation(options: WizardNavigationOptions) {
  const currentStep = ref(0);
  const transitioning = ref(false);

  const canNext = computed(
    () => currentStep.value < options.totalSteps - 1 && !transitioning.value,
  );
  const canPrev = computed(() => currentStep.value > 0 && !transitioning.value);

  const progress = computed(() =>
    options.totalSteps <= 1 ? 1 : currentStep.value / (options.totalSteps - 1),
  );

  const transitionDuration = computed(() =>
    options.prefersReducedMotion.value ? '0ms' : '400ms',
  );

  function goTo(step: number) {
    if (step < 0 || step >= options.totalSteps || transitioning.value) return;
    transitioning.value = true;
    currentStep.value = step;
    setTimeout(
      () => {
        transitioning.value = false;
        // Move focus to the new slide's first heading for keyboard accessibility
        nextTick(() => {
          const headings = options.slidesViewport.value?.querySelectorAll(
            '.slide-content h1, .slide-content h2',
          );
          const target = headings?.[step] as HTMLElement | undefined;
          target?.focus({ preventScroll: true });
        });
      },
      options.prefersReducedMotion.value ? 0 : 420,
    );
  }

  function next() {
    if (currentStep.value < options.totalSteps - 1) {
      goTo(currentStep.value + 1);
    }
  }

  function prev() {
    if (currentStep.value > 0) {
      goTo(currentStep.value - 1);
    }
  }

  /** Keyboard handler — attach to document in the consuming component. */
  function onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      prev();
    }
  }

  return {
    currentStep,
    transitioning,
    canNext,
    canPrev,
    progress,
    transitionDuration,
    goTo,
    next,
    prev,
    onKeydown,
  };
}
