import type { ReleaseManifestEntry } from "@tracepilot/types";
import { ref } from "vue";
import { logWarn } from "@/utils/logger";

const showWhatsNew = ref(false);
const whatsNewPreviousVersion = ref("");
const whatsNewCurrentVersion = ref("");
const whatsNewEntries = ref<ReleaseManifestEntry[]>([]);
const whatsNewReleaseUrl = ref("");

async function fetchManifest(): Promise<ReleaseManifestEntry[]> {
  try {
    const resp = await fetch("/release-manifest.json");
    if (!resp.ok) return [];
    const data = await resp.json();
    const versions = data.versions ?? [];
    return Array.isArray(versions) ? versions : [];
  } catch (e) {
    logWarn("[useWhatsNew] Failed to fetch release manifest", e);
    return [];
  }
}

/** Open the What's New modal for a specific version range. */
export async function openWhatsNew(
  previous: string,
  current: string,
  releaseUrl?: string,
): Promise<void> {
  const entries = await fetchManifest();
  whatsNewEntries.value = entries;
  whatsNewPreviousVersion.value = previous;
  whatsNewCurrentVersion.value = current;
  whatsNewReleaseUrl.value = releaseUrl ?? "";
  showWhatsNew.value = true;
}

export function closeWhatsNew(): void {
  showWhatsNew.value = false;
}

export function useWhatsNew() {
  return {
    showWhatsNew,
    whatsNewPreviousVersion,
    whatsNewCurrentVersion,
    whatsNewEntries,
    whatsNewReleaseUrl,
    openWhatsNew,
    closeWhatsNew,
  };
}
