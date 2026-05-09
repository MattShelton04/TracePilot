// ─── Keyboard Shortcut Registry ────────────────────────────────
// Thin wrapper around `useShortcut` from `@tracepilot/ui` that adds a
// description/group registry so the `<KbdHelpOverlay>` can render every
// currently-active shortcut.
//
// Pattern: a plain ref-based singleton (no Pinia). Pinia is overkill for an
// in-memory, non-persisted, never-cross-window-shared registry, and the
// rest of the codebase reaches for plain composables for similar concerns
// (`useToast`, `useConfirmDialog`, `useDismissable`).

import {
  type KeyHandler,
  type UseShortcutOptions,
  useShortcut as useShortcutPrimitive,
} from "@tracepilot/ui";
import { getCurrentScope, onScopeDispose, readonly, ref } from "vue";

/** Metadata about a registered shortcut. */
export interface ShortcutMeta {
  /** Unique handle for unregister — opaque to callers. */
  id: number;
  /** Combos that trigger the shortcut, e.g. `["Mod+K"]` or `["?", "Mod+/"]`. */
  combos: string[];
  /** Short, user-facing description. */
  description: string;
  /** Group label (e.g. "Global", "Sessions list", "Replay"). */
  group: string;
}

/** Options accepted by {@link useShortcut} (super-set of the UI primitive). */
export interface UseShortcutRegistryOptions extends UseShortcutOptions {
  /** Human-readable description. Required to register in the help overlay. */
  description?: string;
  /** Group label rendered in the help overlay. Defaults to `"Global"`. */
  group?: string;
}

const registry = ref<ShortcutMeta[]>([]);
let nextId = 1;

/**
 * Read-only, reactive list of every shortcut currently registered via
 * {@link useShortcut}. Consumed by `<KbdHelpOverlay>`.
 */
export const registeredShortcuts = readonly(registry);

/** Group the registry by `group`, preserving insertion order. */
export function groupedShortcuts(): Array<{ group: string; items: ShortcutMeta[] }> {
  const groups = new Map<string, ShortcutMeta[]>();
  for (const meta of registry.value) {
    const arr = groups.get(meta.group);
    if (arr) arr.push(meta);
    else groups.set(meta.group, [meta]);
  }
  return Array.from(groups, ([group, items]) => ({ group, items }));
}

/**
 * Register a keyboard shortcut **and** publish it to the global help
 * overlay registry. Drop-in replacement for `useShortcut` from
 * `@tracepilot/ui` — adds optional `description` + `group` metadata.
 *
 * Registration is automatically removed on scope disposal, so navigating
 * away from a view causes its shortcuts to disappear from `?` overlay.
 *
 * @example
 * ```ts
 * useShortcut("Mod+K", openPalette, {
 *   description: "Search sessions",
 *   group: "Global",
 * });
 * ```
 */
export function useShortcut(
  combo: string | readonly string[],
  handler: KeyHandler,
  options: UseShortcutRegistryOptions = {},
): void {
  useShortcutPrimitive(combo, handler, options);

  if (options.description) {
    const id = nextId++;
    const combos = Array.isArray(combo) ? [...combo] : [combo as string];
    const meta: ShortcutMeta = {
      id,
      combos,
      description: options.description,
      group: options.group ?? "Global",
    };
    registry.value = [...registry.value, meta];

    if (getCurrentScope()) {
      onScopeDispose(() => {
        registry.value = registry.value.filter((m) => m.id !== id);
      });
    }
  }
}
