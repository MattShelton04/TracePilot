import type { Ref } from 'vue';
import { onScopeDispose, ref } from 'vue';
import { toErrorMessage } from '../utils/formatters';

export interface UseClipboardOptions {
  /** Duration in ms to show "copied" state. Default: 2000 */
  duration?: number;
}

export interface UseClipboardReturn {
  /** Copy text to clipboard. Returns true on success. */
  copy: (text: string) => Promise<boolean>;
  /** Whether text was recently copied (auto-resets after duration) */
  copied: Ref<boolean>;
  /** Whether clipboard API is supported */
  isSupported: boolean;
  /** Last error message, if any */
  error: Ref<string | null>;
}

/**
 * Composable for copying text to the clipboard with a temporary "copied" state.
 * Each call creates independent state — safe for multiple copy buttons.
 */
export function useClipboard(options?: UseClipboardOptions): UseClipboardReturn {
  const { duration = 2000 } = options ?? {};

  const copied = ref(false);
  const error = ref<string | null>(null);
  const isSupported = !!navigator?.clipboard?.writeText;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  async function copy(text: string): Promise<boolean> {
    error.value = null;
    clearTimer();

    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      timer = setTimeout(() => {
        copied.value = false;
        timer = null;
      }, duration);
      return true;
    } catch (err) {
      error.value = toErrorMessage(err);
      copied.value = false;
      return false;
    }
  }

  onScopeDispose(clearTimer);

  return { copy, copied, isSupported, error };
}
