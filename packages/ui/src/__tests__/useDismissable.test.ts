import { beforeEach, describe, expect, it } from 'vitest';
import { useDismissable } from '../composables/useDismissable';

describe('useDismissable', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts as not dismissed', () => {
    const { isDismissed } = useDismissable('test');
    expect(isDismissed.value).toBe(false);
  });

  it('persists dismiss to localStorage', () => {
    const { isDismissed, dismiss } = useDismissable('test');
    dismiss();
    expect(isDismissed.value).toBe(true);
    expect(localStorage.getItem('tracepilot-dismissed-test')).toBe('true');
  });

  it('reads persisted state on init', () => {
    localStorage.setItem('tracepilot-dismissed-test', 'true');
    const { isDismissed } = useDismissable('test');
    expect(isDismissed.value).toBe(true);
  });

  it('reset clears state', () => {
    const { isDismissed, dismiss, reset } = useDismissable('test');
    dismiss();
    expect(isDismissed.value).toBe(true);
    reset();
    expect(isDismissed.value).toBe(false);
    expect(localStorage.getItem('tracepilot-dismissed-test')).toBeNull();
  });
});
