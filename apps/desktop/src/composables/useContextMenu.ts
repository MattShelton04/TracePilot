import { useOverlayFocus } from "@tracepilot/ui";
import { type MaybeRefOrGetter, nextTick, type Ref, ref, toValue, watch } from "vue";

/** Shared focus, keyboard and viewport placement for desktop action menus.
 * Render native buttons with a menuitem role and tabindex="-1", and wire the
 * returned key handler on the menu panel. Consumers own dismissal/actions;
 * omit position when an existing anchored popover owns placement.
 */
export function useContextMenu(options: {
  active: MaybeRefOrGetter<boolean>;
  panel: Ref<HTMLElement | null>;
  position?: MaybeRefOrGetter<{ x: number; y: number }>;
  initialFocus?: () => HTMLElement | null;
  dismiss: () => void;
}) {
  const placement = ref({ x: 0, y: 0 });
  const menuItems = () => [
    ...(options.panel.value?.querySelectorAll<HTMLButtonElement>(
      ':is([role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]):not(:disabled)',
    ) ?? []),
  ];

  useOverlayFocus({
    active: options.active,
    panel: options.panel,
    initialFocus: () => options.initialFocus?.() ?? menuItems()[0] ?? null,
    onEscape: options.dismiss,
  });

  function updatePosition() {
    if (!toValue(options.active) || !options.panel.value) return;
    const anchor = toValue(options.position);
    if (!anchor) return;
    const { width, height } = options.panel.value.getBoundingClientRect();
    placement.value = {
      x: Math.min(Math.max(8, anchor.x), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(8, anchor.y), Math.max(8, window.innerHeight - height - 8)),
    };
  }

  watch(
    () => [toValue(options.active), toValue(options.position)?.x, toValue(options.position)?.y],
    (_, __, onCleanup) => {
      if (!toValue(options.active) || !options.position) return;
      let active = true;
      nextTick(() => {
        if (active) updatePosition();
      });
      window.addEventListener("resize", updatePosition);
      onCleanup(() => {
        active = false;
        window.removeEventListener("resize", updatePosition);
      });
    },
    { immediate: true },
  );

  function onKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      options.dismiss();
      return;
    }
    const items = menuItems();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let index: number;
    switch (event.key) {
      case "ArrowDown":
        index = (current + 1) % items.length;
        break;
      case "ArrowUp":
        index = (current - 1 + items.length) % items.length;
        break;
      case "Home":
        index = 0;
        break;
      case "End":
        index = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    // Native focus scrolls a long menu so keyboard users can see the active item.
    items[index]?.focus();
  }

  return { placement, onKeydown };
}
