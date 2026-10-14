import { computed, ref, watch } from "vue";

/**
 * The characters `validate_cli_command` (tauri-bindings `validators/path.rs`)
 * accepts: Rust's `char::is_alphanumeric` (Unicode Alphabetic or Numeric) plus
 * `- _ . / \ :` and space. Blank passes here; it means the default command.
 */
const SAFE_CLI_COMMAND = /^[\p{Alphabetic}\p{N}\-_./\\ :]*$/u;

/** True when the backend would accept `value` as a CLI command (or it is blank). */
export function isSafeCliCommand(value: string): boolean {
  return SAFE_CLI_COMMAND.test(value);
}

/**
 * A CLI command field that autosaves: the typed text stays in `draft`, and only
 * a command the backend accepts reaches the preference, so Resume never fails
 * on a value the user thought was saved.
 */
export function useCliCommandDraft(saved: () => string, save: (value: string) => void) {
  const draft = ref(saved());
  watch(saved, (value) => {
    draft.value = value;
  });
  const invalid = computed(() => !isSafeCliCommand(draft.value));

  function update(value: unknown) {
    draft.value = String(value);
    if (!invalid.value) save(draft.value);
  }

  return { draft, invalid, update };
}
