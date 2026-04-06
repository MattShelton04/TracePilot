<script setup lang="ts">
import type { GitHubSkillPreview, LocalSkillPreview, SkillImportResult } from "@tracepilot/types";
import { toErrorMessage } from "@tracepilot/ui";
import { ref, computed, onMounted } from "vue";
import { useSkillsStore } from "@/stores/skills";
import { browseForFile, browseForDirectory } from "@/composables/useBrowseDirectory";
import { useWorktreesStore } from "@/stores/worktrees";
import { usePreferencesStore } from "@/stores/preferences";

const emit = defineEmits<{
  close: [];
  imported: [result: SkillImportResult];
}>();

const store = useSkillsStore();
const worktreeStore = useWorktreesStore();
const prefsStore = usePreferencesStore();

onMounted(async () => {
  if (worktreeStore.registeredRepos.length === 0) {
    await worktreeStore.loadRegisteredRepos();
  }
});

type ImportSource = "local" | "github" | "file";

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
const targetScope = ref<"global" | "project">("global");

const canImport = computed(() => {
  switch (activeTab.value) {
    case "local":
      // When previews are showing, need at least one selected
      if (localPreviews.value.length > 0) return localSelected.value.size > 0;
      return localDir.value.trim().length > 0;
    case "file":
      return filePath.value.trim().length > 0;
    case "github":
      // When previews are showing, need at least one selected
      if (ghPreviews.value.length > 0) return ghSelected.value.size > 0;
      return (
        ghRepoUrl.value.trim().length > 0 ||
        (ghOwner.value.trim().length > 0 && ghRepo.value.trim().length > 0)
      );
  }
});

function parseGhUrl() {
  const url = ghRepoUrl.value.trim();

  // Full GitHub URL: https://github.com/owner/repo/tree/ref/path/to/skills
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

  // Shorthand with path: owner/repo/path/to/skills
  const shortMatch = url.match(/^([^/]+)\/([^/]+?)(?:\/(.+))?$/);
  if (shortMatch) {
    ghOwner.value = shortMatch[1];
    ghRepo.value = shortMatch[2].replace(/\.git$/, "");
    ghRef.value = "";
    ghPath.value = shortMatch[3] ?? "";
  }
}

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
    // Select all by default
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

async function scanGitHub() {
  // Clear previous results before starting a new scan.
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

  // Progress message advances after a couple of seconds.
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
        store.error ?? "No skills found in this repository. Make sure it contains SKILL.md files.";
    } else {
      // Select all by default
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

function finish() {
  if (importResult.value) {
    emit("imported", importResult.value);
  }
  emit("close");
}
</script>

<template>
  <div class="wizard-overlay" @click.self="emit('close')">
    <div class="wizard">
      <div class="wizard__header">
        <div>
          <h3 class="wizard__title">Import Skills</h3>
          <p class="wizard__subtitle">Bring skills from local repos, GitHub, or files into your library</p>
        </div>
        <button class="wizard__close" @click="emit('close')">✕</button>
      </div>

      <!-- Result View -->
      <div v-if="showResult && importResult" class="wizard__body">
        <div class="wizard__result">
          <div class="wizard__result-icon">✅</div>
          <h4 class="wizard__result-title">Skill Imported</h4>
          <p class="wizard__result-name">{{ importResult.skillName }}</p>
          <p class="wizard__result-detail">
            {{ importResult.filesCopied }} file{{ importResult.filesCopied === 1 ? "" : "s" }} copied
          </p>
          <div v-if="importResult.warnings.length > 0" class="wizard__warnings">
            <p v-for="(w, i) in importResult.warnings" :key="i" class="wizard__warning">
              ⚠️ {{ w }}
            </p>
          </div>
        </div>
        <div class="wizard__actions">
          <button class="wizard__btn wizard__btn--primary" @click="finish">Done</button>
        </div>
      </div>

      <!-- Tabbed Import View -->
      <template v-else>
        <!-- Source Tabs -->
        <div class="source-tabs">
          <button
            :class="['source-tab', { active: activeTab === 'local' }]"
            @click="activeTab = 'local'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            Local Repository
          </button>
          <button
            :class="['source-tab', { active: activeTab === 'github' }]"
            @click="activeTab = 'github'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4" /><path d="M9 18c-4.51 2-5-2-7-2" /></svg>
            GitHub
          </button>
          <button
            :class="['source-tab', { active: activeTab === 'file' }]"
            @click="activeTab = 'file'"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="12" y1="18" x2="12" y2="12" /><line x1="9" y1="15" x2="15" y2="15" /></svg>
            File Upload
          </button>
        </div>

        <!-- LOCAL TAB -->
        <div v-if="activeTab === 'local'" class="tab-panel">
          <!-- Quick-select from known repos -->
          <div v-if="worktreeStore.registeredRepos.length > 0 || prefsStore.recentRepoPaths.length > 0" class="input-field" style="margin-bottom: 8px;">
            <label>Quick Select</label>
            <select @change="onSelectRepo($event)" class="repo-select">
              <option value="">Choose a repository…</option>
              <optgroup v-if="worktreeStore.registeredRepos.length" label="Registered Repositories">
                <option v-for="r in worktreeStore.registeredRepos" :key="r.path" :value="r.path">
                  {{ r.name }} — {{ r.path }}
                </option>
              </optgroup>
              <optgroup v-if="prefsStore.recentRepoPaths.length" label="Recent">
                <option v-for="p in prefsStore.recentRepoPaths" :key="p" :value="p">{{ p }}</option>
              </optgroup>
            </select>
          </div>
          <!-- Manual entry + browse -->
          <div class="input-row">
            <div class="input-field">
              <label>Repository Path</label>
              <input
                v-model="localDir"
                type="text"
                placeholder="C:\path\to\repository"
              />
            </div>
            <button class="btn-browse" @click="browseLocalDir" title="Browse for directory">
              📂
            </button>
            <button class="btn-scan" @click="scanLocal" :disabled="!localDir.trim() || localScanning">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              {{ localScanning ? "Scanning…" : "Scan" }}
            </button>
          </div>
          <div class="input-hint">
            Scans <code>.github/skills/</code>, <code>.copilot/skills/</code>, <code>skills/</code>, <code>.github/copilot-skills/</code>
          </div>

          <!-- Scanning progress -->
          <div v-if="localScanning" class="gh-scan-status">
            <span class="gh-scan-spinner" aria-hidden="true"></span>
            Scanning directory…
          </div>

          <!-- Local Skill Preview Cards -->
          <div v-if="localPreviews.length > 0" class="gh-preview">
            <div class="gh-preview__header">
              <label class="gh-preview__toggle-all">
                <input
                  type="checkbox"
                  :checked="localSelected.size === localPreviews.length"
                  :indeterminate="localSelected.size > 0 && localSelected.size < localPreviews.length"
                  @change="toggleAllLocalSkills"
                />
                {{ localPreviews.length }} skill{{ localPreviews.length === 1 ? "" : "s" }} found
              </label>
              <span class="gh-preview__selected">{{ localSelected.size }} selected</span>
            </div>
            <ul class="gh-preview__list">
              <li
                v-for="preview in localPreviews"
                :key="preview.path"
                class="gh-preview__item"
                :class="{ selected: localSelected.has(preview.path) }"
                @click="toggleLocalSkill(preview.path)"
              >
                <input
                  type="checkbox"
                  :checked="localSelected.has(preview.path)"
                  @click.stop
                  @change="toggleLocalSkill(preview.path)"
                />
                <div class="gh-preview__info">
                  <span class="gh-preview__name">{{ preview.name }}</span>
                  <span
                    class="gh-preview__desc"
                    :class="{ 'gh-preview__desc--empty': !preview.description }"
                  >{{ preview.description || 'No description' }}</span>
                  <span class="gh-preview__path">{{ preview.path }}</span>
                </div>
                <span class="gh-preview__badge">
                  {{ preview.fileCount }} file{{ preview.fileCount === 1 ? "" : "s" }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <!-- GITHUB TAB -->
        <div v-if="activeTab === 'github'" class="tab-panel">
          <div class="input-row">
            <div class="input-field">
              <label>Repository URL</label>
              <input
                v-model="ghRepoUrl"
                type="text"
                placeholder="https://github.com/owner/repo  or  owner/repo/path"
                :disabled="ghScanning"
                @keyup.enter="!ghScanning && scanGitHub()"
              />
            </div>
            <button
              v-if="!ghScanning"
              class="btn-scan"
              :disabled="!ghRepoUrl.trim() && !ghOwner.trim()"
              @click="scanGitHub"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              Scan
            </button>
            <button
              v-else
              class="btn-cancel"
              @click="cancelScan"
            >
              Cancel
            </button>
          </div>

          <!-- Scanning progress -->
          <div v-if="ghScanning" class="gh-scan-status">
            <span class="gh-scan-spinner" aria-hidden="true"></span>
            {{ ghScanMessage }}
          </div>
          <div v-else class="input-hint">
            Accepts <code>https://github.com/owner/repo</code>, <code>owner/repo</code>,
            or a URL with a path like <code>.../tree/main/skills</code>
          </div>

          <!-- Skill Preview Cards -->
          <div v-if="ghPreviews.length > 0" class="gh-preview">
            <div class="gh-preview__header">
              <label class="gh-preview__toggle-all">
                <input
                  type="checkbox"
                  :checked="ghSelected.size === ghPreviews.length"
                  :indeterminate="ghSelected.size > 0 && ghSelected.size < ghPreviews.length"
                  @change="toggleAllGhSkills"
                />
                {{ ghPreviews.length }} skill{{ ghPreviews.length === 1 ? "" : "s" }} found
              </label>
              <span class="gh-preview__selected">{{ ghSelected.size }} selected</span>
            </div>
            <ul class="gh-preview__list">
              <li
                v-for="preview in ghPreviews"
                :key="preview.path"
                class="gh-preview__item"
                :class="{ selected: ghSelected.has(preview.path) }"
                @click="toggleGhSkill(preview.path)"
              >
                <input
                  type="checkbox"
                  :checked="ghSelected.has(preview.path)"
                  @click.stop
                  @change="toggleGhSkill(preview.path)"
                />
                <div class="gh-preview__info">
                  <span class="gh-preview__name">{{ preview.name }}</span>
                  <span
                    class="gh-preview__desc"
                    :class="{ 'gh-preview__desc--empty': !preview.description }"
                  >{{ preview.description || 'No description' }}</span>
                  <span class="gh-preview__path">{{ preview.path }}</span>
                </div>
                <span class="gh-preview__badge">
                  {{ preview.fileCount }} file{{ preview.fileCount === 1 ? "" : "s" }}
                </span>
              </li>
            </ul>
          </div>
        </div>

        <!-- FILE TAB -->
        <div v-if="activeTab === 'file'" class="tab-panel">
          <div class="drop-zone" @click="browseFile">
            <div class="drop-zone__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
            </div>
            <div class="drop-zone__label">Click to browse or drop SKILL.md here</div>
            <div class="drop-zone__hint">Or drag a .zip archive containing a skill directory</div>
            <div class="drop-zone__formats">
              <span class="drop-zone__format">SKILL.md</span>
              <span class="drop-zone__format">.zip archive</span>
              <span class="drop-zone__format">directory</span>
            </div>
          </div>
          <div class="input-row" style="margin-top: 12px;">
            <div class="input-field">
              <label>Or enter file path</label>
              <input
                v-model="filePath"
                type="text"
                placeholder="/path/to/SKILL.md"
              />
            </div>
            <button class="btn-browse" @click="browseFile" title="Browse for file">
              📂
            </button>
          </div>
        </div>

        <!-- Error -->
        <div v-if="importError" class="wizard__error">{{ importError }}</div>

        <!-- Import progress -->
        <div v-if="importing" class="import-progress">
          <div class="import-progress__status">
            <span class="gh-scan-spinner" aria-hidden="true"></span>
            <span class="import-progress__message">{{ importStatusMessage }}</span>
          </div>
          <div v-if="importTotal > 1" class="import-progress__bar-wrapper">
            <div class="import-progress__bar">
              <div
                class="import-progress__bar-fill"
                :style="{ width: `${Math.round((importCurrent / importTotal) * 100)}%` }"
              />
            </div>
            <span class="import-progress__count">{{ importCurrent }} / {{ importTotal }}</span>
          </div>
        </div>

        <!-- Footer: scope + import button -->
        <div class="wizard__footer">
          <div class="scope-select">
            <label>Target Scope</label>
            <select v-model="targetScope">
              <option value="global">Global (~/.copilot/skills/)</option>
              <option value="project">Project (.github/skills/)</option>
            </select>
          </div>
          <div class="wizard__footer-right">
            <button class="wizard__btn wizard__btn--secondary" @click="emit('close')">Cancel</button>
            <button
              class="wizard__btn wizard__btn--primary"
              :disabled="!canImport || importing"
              @click="doImport"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              {{ importing ? "Importing…" : "Import Skills" }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.wizard {
  width: 620px;
  max-width: 90vw;
  max-height: 85vh;
  overflow-y: auto;
  background: var(--canvas-default);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-lg);
}

.wizard__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-muted);
}

.wizard__title {
  font-size: 1.125rem;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: var(--text-primary);
  margin: 0;
}

.wizard__subtitle {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 2px 0 0;
}

.wizard__close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 1rem;
  padding: 4px;
}

.wizard__close:hover {
  color: var(--text-primary);
}

/* ── Source Tabs ──────────────────────────────────────────── */
.source-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border-default);
}

.source-tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 18px;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--text-tertiary);
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.source-tab:hover {
  color: var(--text-primary);
}

.source-tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-emphasis);
}

.source-tab svg {
  width: 15px;
  height: 15px;
  opacity: 0.5;
}

.source-tab.active svg {
  opacity: 0.9;
  color: var(--accent-fg);
}

/* ── Tab Panel ───────────────────────────────────────────── */
.tab-panel {
  padding: 20px 24px;
  animation: panelFadeIn 0.2s ease;
}

@keyframes panelFadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ── Inputs ──────────────────────────────────────────────── */
.input-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.input-field {
  flex: 1;
}

.input-field label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.input-field input {
  width: 100%;
  padding: 9px 12px;
  background: var(--canvas-inset, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  transition: all var(--transition-fast);
  box-sizing: border-box;
}

.input-field input:focus {
  border-color: var(--accent-emphasis);
}

.input-field input::placeholder {
  color: var(--text-tertiary);
}

.input-hint {
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  margin-top: 8px;
}

.input-hint code {
  font-family: ui-monospace, monospace;
  font-size: 0.6875rem;
  color: var(--accent-fg);
  background: var(--accent-subtle, rgba(99, 102, 241, 0.04));
  padding: 1px 5px;
  border-radius: 3px;
}

.btn-scan {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 600;
  border: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  color: var(--text-primary);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  align-self: flex-end;
  font-family: inherit;
}

.btn-scan:hover:not(:disabled) {
  background: var(--canvas-inset, var(--canvas-subtle));
  border-color: var(--accent-emphasis);
}

.btn-scan:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-scan svg {
  width: 14px;
  height: 14px;
}

.btn-browse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  cursor: pointer;
  font-size: 1rem;
  flex-shrink: 0;
  align-self: flex-end;
  transition: all var(--transition-fast);
}

.btn-browse:hover {
  background: var(--neutral-subtle);
  border-color: var(--border-emphasis);
}

.repo-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-inset);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
}

/* ── Drop Zone ───────────────────────────────────────────── */
.drop-zone {
  border: 2px dashed var(--border-default);
  border-radius: var(--radius-lg);
  padding: 40px 24px;
  text-align: center;
  transition: all 0.2s ease;
  cursor: pointer;
  background: var(--canvas-subtle);
}

.drop-zone:hover {
  border-color: var(--accent-emphasis);
  background: var(--accent-subtle, rgba(99, 102, 241, 0.04));
}

.drop-zone__icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 14px;
  border-radius: var(--radius-lg);
  background: var(--accent-muted);
  display: flex;
  align-items: center;
  justify-content: center;
}

.drop-zone__icon svg {
  width: 24px;
  height: 24px;
  color: var(--accent-fg);
}

.drop-zone__label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.drop-zone__hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}

.drop-zone__formats {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 8px;
}

.drop-zone__format {
  font-size: 0.625rem;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--canvas-subtle);
  color: var(--text-tertiary);
  border: 1px solid var(--border-default);
}

/* ── Error ────────────────────────────────────────────────── */
.wizard__error {
  margin: 0 24px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--danger-muted);
  color: var(--danger-fg);
  font-size: 0.8125rem;
}

/* ── Footer ──────────────────────────────────────────────── */
.wizard__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-default);
}

.scope-select {
  flex: 1;
  min-width: 200px;
}

.scope-select label {
  display: block;
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 6px;
}

.scope-select select {
  width: 100%;
  padding: 8px 28px 8px 10px;
  background: var(--canvas-inset, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  outline: none;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.scope-select select:focus {
  border-color: var(--accent-emphasis);
}

.wizard__footer-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

/* ── Buttons ─────────────────────────────────────────────── */
.wizard__body {
  padding: 20px 24px;
}

.wizard__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.wizard__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 20px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.wizard__btn--secondary {
  background: var(--canvas-subtle);
  border: 1px solid var(--border-default);
  color: var(--text-primary);
}

.wizard__btn--secondary:hover {
  background: var(--canvas-inset);
}

.wizard__btn--primary {
  background: var(--gradient-accent, var(--accent-emphasis));
  border: 1px solid transparent;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 1px 6px rgba(99, 102, 241, 0.3);
}

.wizard__btn--primary:hover:not(:disabled) {
  box-shadow: 0 4px 16px rgba(99, 102, 241, 0.35);
  transform: translateY(-1px);
}

.wizard__btn--primary:active {
  transform: translateY(0);
}

.wizard__btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

/* ── Result ──────────────────────────────────────────────── */
.wizard__result {
  text-align: center;
  padding: 16px 0;
}

.wizard__result-icon {
  font-size: 2rem;
  margin-bottom: 8px;
}

.wizard__result-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}

.wizard__result-name {
  font-size: 0.875rem;
  color: var(--accent-fg);
  font-weight: 500;
  margin: 0 0 4px;
}

.wizard__result-detail {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin: 0;
}

.wizard__warnings {
  margin-top: 12px;
  text-align: left;
}

.wizard__warning {
  font-size: 0.8125rem;
  color: var(--warning-fg);
  margin: 4px 0;
}

/* ── GitHub Preview List ─────────────────────────────────── */
.gh-scan-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-top: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.gh-scan-spinner {
  display: inline-block;
  width: 13px;
  height: 13px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-fg);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

.btn-cancel {
  display: inline-flex;
  align-items: center;
  padding: 9px 14px;
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  font-weight: 500;
  border: 1px solid var(--danger-fg);
  background: transparent;
  color: var(--danger-fg);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
  align-self: flex-end;
  font-family: inherit;
}

.btn-cancel:hover {
  background: var(--danger-muted, rgba(239, 68, 68, 0.08));
}

.gh-preview {
  margin-top: 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.gh-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--canvas-subtle);
  border-bottom: 1px solid var(--border-default);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.gh-preview__toggle-all {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.gh-preview__toggle-all input[type="checkbox"] {
  accent-color: var(--accent-emphasis);
  cursor: pointer;
}

.gh-preview__selected {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-tertiary);
}

.gh-preview__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 240px;
  overflow-y: auto;
}

.gh-preview__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-muted);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.gh-preview__item:last-child {
  border-bottom: none;
}

.gh-preview__item:hover {
  background: var(--canvas-subtle);
}

.gh-preview__item.selected {
  background: var(--accent-subtle, rgba(99, 102, 241, 0.04));
}

.gh-preview__item input[type="checkbox"] {
  accent-color: var(--accent-emphasis);
  cursor: pointer;
  flex-shrink: 0;
}

.gh-preview__info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gh-preview__name {
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-preview__desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-preview__desc--empty {
  color: var(--text-tertiary);
  font-style: italic;
}

.gh-preview__path {
  font-size: 0.625rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gh-preview__badge {
  font-size: 0.625rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--canvas-subtle);
  color: var(--text-secondary);
  border: 1px solid var(--border-default);
  white-space: nowrap;
  flex-shrink: 0;
}

/* ── Import Progress ─────────────────────────────────────── */
.import-progress {
  padding: 12px 24px;
  animation: panelFadeIn 0.2s ease;
}

.import-progress__status {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.import-progress__message {
  font-weight: 500;
}

.import-progress__bar-wrapper {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}

.import-progress__bar {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--canvas-inset, var(--canvas-subtle));
  border: 1px solid var(--border-default);
  overflow: hidden;
}

.import-progress__bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--accent-emphasis);
  transition: width 0.3s ease;
}

.import-progress__count {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-tertiary);
  font-family: ui-monospace, "JetBrains Mono", monospace;
  white-space: nowrap;
}
</style>
