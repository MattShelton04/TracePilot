import type {
  GitHubSkillPreview,
  LocalSkillPreview,
  SkillImportResult,
} from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import {
  computed,
  inject,
  type InjectionKey,
  onMounted,
  reactive,
  ref,
} from "vue";
import { browseForDirectory, browseForFile } from "@/composables/useBrowseDirectory";
import { usePreferencesStore } from "@/stores/preferences";
import { useSkillsStore } from "@/stores/skills";
import { useWorktreesStore } from "@/stores/worktrees";

/**
 * State + actions for `SkillImportWizard`.
 *
 * Extracted from `components/skills/SkillImportWizard.vue` in Wave 31. Behaviour
 * is preserved byte-for-byte; the shell now provides a single instance of this
 * composable which the three tab children consume via `provide`/`inject`
 * (`SkillImportWizardKey` + `useSkillImportWizardContext`).
 */

export type ImportSource = "local" | "github" | "file";
export type ImportScope = "global" | "project";

export interface SkillImportWizardOptions {
  onImported: (result: SkillImportResult) => void;
  onClose: () => void;
}

export function useSkillImportWizard(options: SkillImportWizardOptions) {
  const store = useSkillsStore();
  const worktreeStore = useWorktreesStore();
  const prefsStore = usePreferencesStore();

  // ── State ───────────────────────────────────────────────────────────
  const activeTab = ref<ImportSource>("local");
  const importing = ref(false);
  const importError = ref<string | null>(null);
  const importResult = ref<SkillImportResult | null>(null);
  const showResult = ref(false);
  const importStatusMessage = ref("");
  const importCurrent = ref(0);
  const importTotal = ref(0);

  // Local import fields
  const localDir = ref("");
  const localPreviews = ref<LocalSkillPreview[]>([]);
  const localSelected = ref<Set<string>>(new Set());
  const localScanning = ref(false);

  // File import fields
  const filePath = ref("");

  // GitHub import fields
  const ghRepoUrl = ref("");
  const ghOwner = ref("");
  const ghRepo = ref("");
  const ghPath = ref("");
  const ghRef = ref("");
  const ghPreviews = ref<GitHubSkillPreview[]>([]);
  const ghSelected = ref<Set<string>>(new Set());
  const ghScanning = ref(false);
  const ghScanMessage = ref("");
  let _scanController: { cancelled: boolean } | null = null;

  // Target scope
  const targetScope = ref<ImportScope>("global");

  // ── Computed ────────────────────────────────────────────────────────
  const canImport = computed(() => {
    switch (activeTab.value) {
      case "local":
        if (localPreviews.value.length > 0) return localSelected.value.size > 0;
        return localDir.value.trim().length > 0;
      case "file":
        return filePath.value.trim().length > 0;
      case "github":
        if (ghPreviews.value.length > 0) return ghSelected.value.size > 0;
        return (
          ghRepoUrl.value.trim().length > 0 ||
          (ghOwner.value.trim().length > 0 && ghRepo.value.trim().length > 0)
        );
    }
  });

  // ── GitHub URL parsing ──────────────────────────────────────────────
  function parseGhUrl() {
    const url = ghRepoUrl.value.trim();

    const fullMatch = url.match(
      /github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)(?:\/(.+))?)?(?:\/?$)/,
    );
    if (fullMatch) {
      ghOwner.value = fullMatch[1];
      ghRepo.value = fullMatch[2];
      ghRef.value = fullMatch[3] ?? "";
      ghPath.value = fullMatch[4] ?? "";
      return;
    }

    const shortMatch = url.match(/^([^/]+)\/([^/]+?)(?:\/(.+))?$/);
    if (shortMatch) {
      ghOwner.value = shortMatch[1];
      ghRepo.value = shortMatch[2].replace(/\.git$/, "");
      ghRef.value = "";
      ghPath.value = shortMatch[3] ?? "";
    }
  }

  // ── Local scan + selection ──────────────────────────────────────────
  async function scanLocal() {
    localScanning.value = true;
    localPreviews.value = [];
    localSelected.value = new Set();
    importError.value = null;

    const previews = await store.discoverLocal(localDir.value.trim());
    localScanning.value = false;

    if (previews.length === 0) {
      importError.value =
        store.error ??
        "No skills found. Check that the directory contains SKILL.md files in standard locations (.github/skills/, .copilot/skills/, skills/).";
    } else {
      localSelected.value = new Set(previews.map((p) => p.path));
      localPreviews.value = previews;
    }
  }

  function toggleLocalSkill(path: string) {
    const next = new Set(localSelected.value);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    localSelected.value = next;
  }

  function toggleAllLocalSkills() {
    if (localSelected.value.size === localPreviews.value.length) {
      localSelected.value = new Set();
    } else {
      localSelected.value = new Set(localPreviews.value.map((p) => p.path));
    }
  }

  // ── GitHub scan + selection ─────────────────────────────────────────
  async function scanGitHub() {
    ghPreviews.value = [];
    ghSelected.value = new Set();
    importError.value = null;

    parseGhUrl();
    if (!ghOwner.value || !ghRepo.value) {
      importError.value = "Could not parse GitHub owner/repo from URL";
      return;
    }

    ghScanning.value = true;
    ghScanMessage.value = "Connecting to GitHub…";

    const controller = { cancelled: false };
    _scanController = controller;

    const msgTimer = setTimeout(() => {
      if (!controller.cancelled) ghScanMessage.value = "Scanning repository tree…";
    }, 2000);

    try {
      const previews = await store.discoverGitHub(
        ghOwner.value,
        ghRepo.value,
        ghPath.value || undefined,
        ghRef.value || undefined,
      );

      if (controller.cancelled) return;

      ghPreviews.value = previews;
      if (previews.length === 0) {
        importError.value =
          store.error ??
          "No skills found in this repository. Make sure it contains SKILL.md files.";
      } else {
        ghSelected.value = new Set(previews.map((p) => p.path));
      }
    } catch (e) {
      if (!controller.cancelled) {
        importError.value = toErrorMessage(e);
      }
    } finally {
      clearTimeout(msgTimer);
      ghScanning.value = false;
      ghScanMessage.value = "";
      _scanController = null;
    }
  }

  function cancelScan() {
    if (_scanController) {
      _scanController.cancelled = true;
      _scanController = null;
    }
    ghScanning.value = false;
    ghScanMessage.value = "";
  }

  function toggleGhSkill(path: string) {
    const next = new Set(ghSelected.value);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    ghSelected.value = next;
  }

  function toggleAllGhSkills() {
    if (ghSelected.value.size === ghPreviews.value.length) {
      ghSelected.value = new Set();
    } else {
      ghSelected.value = new Set(ghPreviews.value.map((p) => p.path));
    }
  }

  // ── Import flow ─────────────────────────────────────────────────────
  async function doImport() {
    importing.value = true;
    importError.value = null;
    importResult.value = null;
    importStatusMessage.value = "";
    importCurrent.value = 0;
    importTotal.value = 0;

    try {
      let result: SkillImportResult | null = null;
      switch (activeTab.value) {
        case "local":
          if (localPreviews.value.length > 0 && localSelected.value.size > 0) {
            const paths = [...localSelected.value];
            importTotal.value = paths.length;
            let imported = 0;
            const warnings: string[] = [];
            for (let i = 0; i < paths.length; i++) {
              importCurrent.value = i + 1;
              const preview = localPreviews.value.find((p) => p.path === paths[i]);
              importStatusMessage.value = preview
                ? `Importing "${preview.name}" (${i + 1} of ${paths.length})…`
                : `Importing skill ${i + 1} of ${paths.length}…`;
              const r = await store.importLocal(paths[i], targetScope.value);
              if (r) {
                imported++;
                warnings.push(...r.warnings);
              }
            }
            if (imported > 0) {
              result = {
                skillName: `${imported} skill(s)`,
                destination: "",
                warnings,
                filesCopied: imported,
              };
            }
          } else {
            importTotal.value = 1;
            importCurrent.value = 1;
            importStatusMessage.value = "Importing skill…";
            result = await store.importLocal(localDir.value.trim(), targetScope.value);
          }
          break;
        case "file":
          importTotal.value = 1;
          importCurrent.value = 1;
          importStatusMessage.value = "Importing file…";
          result = await store.importFile(filePath.value.trim(), targetScope.value);
          break;
        case "github": {
          if (ghPreviews.value.length > 0 && ghSelected.value.size > 0) {
            const paths = [...ghSelected.value];
            importTotal.value = paths.length;
            let imported = 0;
            const warnings: string[] = [];
            for (let i = 0; i < paths.length; i++) {
              importCurrent.value = i + 1;
              const preview = ghPreviews.value.find((p) => p.path === paths[i]);
              importStatusMessage.value = preview
                ? `Fetching "${preview.name}" from GitHub (${i + 1} of ${paths.length})…`
                : `Importing skill ${i + 1} of ${paths.length}…`;
              const r = await store.importGitHubSkill(
                ghOwner.value.trim(),
                ghRepo.value.trim(),
                paths[i],
                ghRef.value || undefined,
                targetScope.value,
              );
              if (r) {
                imported++;
                warnings.push(...r.warnings);
              }
            }
            if (imported > 0) {
              result = {
                skillName: `${imported} skill(s)`,
                destination: "",
                warnings,
                filesCopied: imported,
              };
            }
          } else {
            importTotal.value = 1;
            importCurrent.value = 1;
            parseGhUrl();
            importStatusMessage.value = "Fetching skill from GitHub…";
            result = await store.importGitHub(
              ghOwner.value.trim(),
              ghRepo.value.trim(),
              ghPath.value.trim() || undefined,
              ghRef.value.trim() || undefined,
              targetScope.value,
            );
          }
          break;
        }
      }

      if (result) {
        importResult.value = result;
        showResult.value = true;
      } else {
        importError.value = store.error ?? "Import failed";
      }
    } catch (e) {
      importError.value = toErrorMessage(e);
    } finally {
      importing.value = false;
      importStatusMessage.value = "";
      importCurrent.value = 0;
      importTotal.value = 0;
    }
  }

  // ── File / directory browsing ───────────────────────────────────────
  async function browseFile() {
    const path = await browseForFile({
      title: "Select SKILL.md file",
      filters: [
        { name: "Skill Files", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (path) filePath.value = path;
  }

  async function browseLocalDir() {
    const path = await browseForDirectory({
      title: "Select repository or skill directory",
    });
    if (path) localDir.value = path;
  }

  function onSelectRepo(event: Event) {
    const val = (event.target as HTMLSelectElement).value;
    if (val) localDir.value = val;
  }

  // ── Finish / close ──────────────────────────────────────────────────
  function finish() {
    if (importResult.value) {
      options.onImported(importResult.value);
    }
    options.onClose();
  }

  function requestClose() {
    options.onClose();
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  onMounted(async () => {
    if (worktreeStore.registeredRepos.length === 0) {
      await worktreeStore.loadRegisteredRepos();
    }
  });

  return reactive({
    // store handles (needed by local tab for quick-select)
    worktreeStore,
    prefsStore,
    // state
    activeTab,
    importing,
    importError,
    importResult,
    showResult,
    importStatusMessage,
    importCurrent,
    importTotal,
    localDir,
    localPreviews,
    localSelected,
    localScanning,
    filePath,
    ghRepoUrl,
    ghOwner,
    ghRepo,
    ghPath,
    ghRef,
    ghPreviews,
    ghSelected,
    ghScanning,
    ghScanMessage,
    targetScope,
    // computed
    canImport,
    // actions
    scanLocal,
    toggleLocalSkill,
    toggleAllLocalSkills,
    scanGitHub,
    cancelScan,
    toggleGhSkill,
    toggleAllGhSkills,
    doImport,
    browseFile,
    browseLocalDir,
    onSelectRepo,
    finish,
    requestClose,
  });
}

export type SkillImportWizardContext = ReturnType<typeof useSkillImportWizard>;

export const SkillImportWizardKey: InjectionKey<SkillImportWizardContext> = Symbol(
  "SkillImportWizardContext",
);

export function useSkillImportWizardContext(): SkillImportWizardContext {
  const ctx = inject(SkillImportWizardKey);
  if (!ctx) {
    throw new Error(
      "useSkillImportWizardContext must be used within a SkillImportWizard shell",
    );
  }
  return ctx;
}
