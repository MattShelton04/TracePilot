import type { ReleaseManifestEntry } from "@tracepilot/types";
import { ref } from "vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { updateResult } from "@/composables/useUpdateCheck";
import { logWarn } from "@/utils/logger";

/**
 * Why the modal is open:
 * - `updated`: the app started on a newer version than it last saw.
 * - `preview`: an update is available and the user asked what it contains.
 * - `history`: the user asked for the release notes of the installed version.
 */
export type WhatsNewKind = "updated" | "preview" | "history";

export interface OpenWhatsNewOptions {
  kind?: WhatsNewKind;
  releaseUrl?: string;
  releaseNotes?: string;
}

const showWhatsNew = ref(false);
const whatsNewKind = ref<WhatsNewKind>("updated");
const whatsNewPreviousVersion = ref("");
const whatsNewCurrentVersion = ref("");
const whatsNewEntries = ref<ReleaseManifestEntry[]>([]);
const whatsNewReleaseUrl = ref("");
const whatsNewReleaseNotes = ref("");

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
  options: OpenWhatsNewOptions = {},
): Promise<void> {
  const entries = await fetchManifest();
  whatsNewEntries.value = entries;
  whatsNewKind.value = options.kind ?? "updated";
  whatsNewPreviousVersion.value = previous;
  whatsNewCurrentVersion.value = current;
  whatsNewReleaseUrl.value = options.releaseUrl ?? "";
  whatsNewReleaseNotes.value = options.releaseNotes ?? "";
  showWhatsNew.value = true;
}

/** Preview the notes of the available update, or the installed version's notes when there is none. */
export async function openUpdatePreview(): Promise<void> {
  const { appVersion } = useAppVersion();
  const result = updateResult.value;
  if (result?.hasUpdate && result.latestVersion) {
    await openWhatsNew(result.currentVersion || appVersion.value, result.latestVersion, {
      kind: "preview",
      releaseUrl: result.releaseUrl ?? undefined,
      releaseNotes: result.releaseNotes ?? undefined,
    });
  } else {
    await openReleaseHistory();
  }
}

/** Show the release notes of every bundled version up to the installed one. */
export async function openReleaseHistory(): Promise<void> {
  const { appVersion } = useAppVersion();
  await openWhatsNew("0.0.0", appVersion.value, { kind: "history" });
}

export function closeWhatsNew(): void {
  showWhatsNew.value = false;
}

export function useWhatsNew() {
  return {
    showWhatsNew,
    whatsNewKind,
    whatsNewPreviousVersion,
    whatsNewCurrentVersion,
    whatsNewEntries,
    whatsNewReleaseUrl,
    whatsNewReleaseNotes,
    openWhatsNew,
    openUpdatePreview,
    openReleaseHistory,
    closeWhatsNew,
  };
}
