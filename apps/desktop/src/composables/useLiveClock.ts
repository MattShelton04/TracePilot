import { computed, onMounted, onScopeDispose, ref } from "vue";

/**
 * Updates a reactive `now` ref every `intervalMs` milliseconds while the
 * component (or effect scope) is active, and exposes an HH:MM:SS string.
 */
export function useLiveClock(intervalMs = 1000) {
  const now = ref(new Date());
  let timer: ReturnType<typeof setInterval> | null = null;

  onMounted(() => {
    timer = setInterval(() => {
      now.value = new Date();
    }, intervalMs);
  });

  onScopeDispose(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });

  const liveTime = computed(() => {
    const d = now.value;
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  });

  return { now, liveTime };
}
