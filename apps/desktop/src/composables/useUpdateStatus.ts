import { formatDateMedium, formatRelativeTime } from "@tracepilot/ui";
import { computed } from "vue";
import { useAppVersion } from "@/composables/useAppVersion";
import { useUpdateCheck } from "@/composables/useUpdateCheck";
import { displayVersion } from "@/utils/releaseNotes";

/** Where the update check stands, as shown in Settings and the release notes dialog. */
export type UpdateState = "checking" | "error" | "available" | "current" | "unknown";

/** Derived, display-ready state of the shared update check. */
export function useUpdateStatus() {
  const { appVersion } = useAppVersion();
  const { updateResult, updateCheckLoading, updateCheckError, updateCheckedAt } = useUpdateCheck();

  const installed = computed(() => displayVersion(appVersion.value));
  const latest = computed(() => displayVersion(updateResult.value?.latestVersion ?? ""));
  const hasUpdate = computed(() => updateResult.value?.hasUpdate === true);

  const state = computed<UpdateState>(() => {
    if (updateCheckLoading.value) return "checking";
    if (updateCheckError.value) return "error";
    if (hasUpdate.value) return "available";
    return updateResult.value ? "current" : "unknown";
  });

  const checkedAgo = computed(() =>
    updateCheckedAt.value ? formatRelativeTime(updateCheckedAt.value / 1000) : "",
  );

  const published = computed(() => formatDateMedium(updateResult.value?.publishedAt));

  /** One-line summary, as Settings → Updates shows it. */
  const statusText = computed(() => {
    switch (state.value) {
      case "checking":
        return "Checking GitHub for a newer release…";
      case "error":
        return `Couldn't check for updates: ${updateCheckError.value}`;
      case "available":
        return `${latest.value} is available${published.value ? ` · released ${published.value}` : ""}`;
      case "current":
        return `You're up to date${checkedAgo.value ? ` · checked ${checkedAgo.value}` : ""}`;
      default:
        return "Not checked yet";
    }
  });

  /** Short two-line form for compact surfaces such as the release notes dialog. */
  const headline = computed(() => {
    switch (state.value) {
      case "checking":
        return "Checking for updates…";
      case "error":
        return "Couldn't check for updates";
      case "available":
        return `${latest.value} is available`;
      case "current":
        return "You're up to date";
      default:
        return "Updates not checked yet";
    }
  });

  const detail = computed(() => {
    switch (state.value) {
      case "checking":
        return "Asking GitHub for the latest release";
      case "error":
        return updateCheckError.value ?? "";
      case "available":
        return published.value ? `Released ${published.value}` : `You're on ${installed.value}`;
      case "current":
        return checkedAgo.value ? `Checked ${checkedAgo.value}` : "";
      default:
        return "Ask GitHub whether a newer release is out";
    }
  });

  return { installed, latest, hasUpdate, state, statusText, headline, detail };
}
