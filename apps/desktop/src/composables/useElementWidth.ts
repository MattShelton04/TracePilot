import { onBeforeUnmount, onMounted, type Ref, ref } from "vue";

/** The element's content width, kept current with a ResizeObserver. */
export function useElementWidth(target: Ref<HTMLElement | null>, initial = 0) {
  const width = ref(initial);
  let observer: ResizeObserver | null = null;

  onMounted(() => {
    const el = target.value;
    if (!el) return;
    width.value = el.clientWidth || initial;
    if (typeof ResizeObserver === "undefined") return;
    observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) width.value = next;
    });
    observer.observe(el);
  });

  onBeforeUnmount(() => observer?.disconnect());

  return width;
}
