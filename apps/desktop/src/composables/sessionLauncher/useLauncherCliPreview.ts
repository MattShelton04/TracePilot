import type { LaunchConfig } from "@tracepilot/types";
import { DEFAULT_CLI_COMMAND } from "@tracepilot/types";
import { type ComputedRef, computed } from "vue";
import { usePreferencesStore } from "@/stores/preferences";
import type { CliPart } from "./types";

/**
 * Build the structured CLI preview as a `CliPart[]` once, then derive
 * the flat string view from the same source. This is the single source of
 * truth for the launcher's CLI preview — adding a new flag should require
 * editing only `buildLaunchCliArgs`.
 */
export function buildLaunchCliArgs(cfg: LaunchConfig, effectiveCli: string): CliPart[] {
  if (cfg.launchMode === "sdk") {
    return [{ flag: "Copilot SDK bridge" }, { flag: "headless session" }];
  }
  const parts: CliPart[] = [{ flag: effectiveCli }];
  if (cfg.model) parts.push({ flag: "--model", value: cfg.model });
  if (cfg.autoApprove) parts.push({ flag: "--allow-all" });
  if (cfg.uiServer) parts.push({ flag: "--ui-server" });
  if (cfg.reasoningEffort) {
    parts.push({ flag: "--reasoning-effort", value: cfg.reasoningEffort });
  }
  if (cfg.prompt) {
    parts.push({ flag: "--interactive", value: cfg.prompt });
  }
  return parts;
}

/**
 * Render a single `CliPart` to the form used in the flat command string.
 * The prompt value (`--interactive`) is single-quoted with `'` doubled,
 * matching the previous inline implementation.
 */
function renderCliPart(part: CliPart): string {
  if (part.value === undefined) return part.flag;
  if (part.flag === "--interactive") {
    return `${part.flag} '${part.value.replace(/'/g, "''")}'`;
  }
  return `${part.flag} ${part.value}`;
}

export function useLauncherCliPreview(launchConfig: ComputedRef<LaunchConfig>) {
  const prefsStore = usePreferencesStore();

  const effectiveCli = computed(() => prefsStore.cliCommand || DEFAULT_CLI_COMMAND);

  const cliCommandParts = computed<CliPart[]>(() =>
    buildLaunchCliArgs(launchConfig.value, effectiveCli.value),
  );

  const cliCommand = computed(() => {
    if (launchConfig.value.launchMode === "sdk") {
      return "Copilot SDK bridge (headless session)";
    }
    return cliCommandParts.value.map(renderCliPart).join(" ");
  });

  return {
    effectiveCli,
    cliCommand,
    cliCommandParts,
  };
}

export type UseLauncherCliPreviewReturn = ReturnType<typeof useLauncherCliPreview>;
