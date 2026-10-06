import { type ComputedRef, computed, type InjectionKey, inject } from "vue";

/**
 * The main agent's display name for the session being viewed ("Copilot",
 * "Claude Code"). Session views provide it from the session's source;
 * without a provider the label stays "Copilot".
 */
export const MAIN_AGENT_LABEL_KEY: InjectionKey<ComputedRef<string>> = Symbol("MainAgentLabel");

const DEFAULT_MAIN_AGENT_LABEL = "Copilot";

/** The injected main-agent label, or "Copilot" when none is provided. */
export function useMainAgentLabel(): ComputedRef<string> {
  const label = inject(MAIN_AGENT_LABEL_KEY, null);
  return computed(() => label?.value ?? DEFAULT_MAIN_AGENT_LABEL);
}
