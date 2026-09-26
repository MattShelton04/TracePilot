/**
 * Live sessions preferences slice (ADR-0016).
 *
 * Owns whether TracePilot attaches automatically to sessions running in a
 * `copilot --ui-server` terminal, and whether the terminals it launches or
 * resumes get `--ui-server` so they can be attached.
 */

import type { TracePilotConfig } from "@tracepilot/types";
import { ref } from "vue";

type LiveConfig = TracePilotConfig["live"];

export function createLiveSlice() {
  /** Attach automatically to attachable sessions when they are opened. */
  const liveAutoAttach = ref(true);
  /** Launch and resume terminals with `--ui-server`. */
  const liveLaunchAttachable = ref(true);

  function hydrateLive(config: Partial<LiveConfig> | undefined) {
    liveAutoAttach.value = config?.autoAttach ?? true;
    liveLaunchAttachable.value = config?.launchAttachable ?? true;
  }

  function buildLiveConfig(): LiveConfig {
    return {
      autoAttach: liveAutoAttach.value,
      launchAttachable: liveLaunchAttachable.value,
    };
  }

  return { liveAutoAttach, liveLaunchAttachable, hydrateLive, buildLiveConfig };
}
