<script setup lang="ts">
import type { SkillAsset, SkillFrontmatter } from "@tracepilot/types";
import { MarkdownContent, useConfirmDialog, useResizeHandle } from "@tracepilot/ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import SkillAssetsTree from "@/components/skills/SkillAssetsTree.vue";
import SkillScopeBadge from "@/components/skills/SkillScopeBadge.vue";
import { browseForFile } from "@/composables/useBrowseDirectory";
import { useSkillsStore } from "@/stores/skills";
import { logWarn } from "@/utils/logger";
import { openExternal } from "@/utils/openExternal";
import { parseSkillContent, serializeSkillContent } from "@/utils/skillFrontmatter";

const route = useRoute();
const router = useRouter();
const store = useSkillsStore();
const { confirm: showConfirm } = useConfirmDialog();

// ─── State ────────────────────────────────────────────────
const saving = ref(false);
const deleting = ref(false);
const rawContent = ref("");
const assets = ref<SkillAsset[]>([]);
const assetsLoading = ref(false);
const editorDirty = ref(false);
const lastSaved = ref<Date | null>(null);
const editorRef = ref<HTMLTextAreaElement | null>(null);
const lineNumbersRef = ref<HTMLElement | null>(null);
const viewingAsset = ref<SkillAsset | null>(null);
const viewingContent = ref<string | null>(null);

const previewFrontmatter = ref<SkillFrontmatter | null>(null);
const previewBody = ref("");

// ─── Resize handle ────────────────────────────────────────
const { leftWidth, dragging, containerRef, onMouseDown } = useResizeHandle({
  minPct: 25,
  maxPct: 75,
  initial: 50,
});

// ─── Computed ─────────────────────────────────────────────
const skillDir = computed(() => {
  const param = route.params.name;
  return typeof param === "string" ? decodeURIComponent(param) : "";
});

const editorLineNumbers = computed(() => {
  const count = previewBody.value.split("\n").length;
  return Array.from({ length: count }, (_, i) => i + 1);
});

const totalLineCount = computed(() => rawContent.value.split("\n").length);
const byteCount = computed(() => new TextEncoder().encode(rawContent.value).length);

const descCharCount = computed(() => previewFrontmatter.value?.description?.length ?? 0);
const descCharClass = computed(() => {
  if (descCharCount.value >= 1024) return "at-limit";
  if (descCharCount.value >= 900) return "near-limit";
  return "";
});

const lastSavedDisplay = computed(() => {
  if (!lastSaved.value) return "Not saved yet";
  const diff = Math.floor((Date.now() - lastSaved.value.getTime()) / 1000);
  if (diff < 10) return "Just saved";
  if (diff < 60) return `Saved ${diff}s ago`;
  const mins = Math.floor(diff / 60);
  return `Saved ${mins} min ago`;
});

// ─── Lifecycle ────────────────────────────────────────────
onMounted(async () => {
  if (skillDir.value) await loadSkill();
  document.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleKeydown);
});

watch(skillDir, async (dir) => {
  if (dir) await loadSkill();
});

// ─── Core logic ───────────────────────────────────────────
function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    if (editorDirty.value && !saving.value) handleSave();
  }
}

async function loadSkill() {
  const skill = await store.getSkill(skillDir.value);
  if (skill) {
    rawContent.value = skill.rawContent;
    editorDirty.value = false;
    parseContent(skill.rawContent);
    loadAssets();
  }
}

function parseContent(content: string) {
  const parsed = parseSkillContent(content);
  previewBody.value = parsed.body;
  previewFrontmatter.value = parsed.frontmatter;

  if (parsed.status !== "parsed") {
    logWarn("[SkillEditor] Failed to parse frontmatter:", content.substring(0, 100));
  }
}

function rebuildRawContent() {
  rawContent.value = serializeSkillContent(previewFrontmatter.value, previewBody.value);
  editorDirty.value = true;
}

async function loadAssets() {
  assetsLoading.value = true;
  assets.value = await store.listAssets(skillDir.value);
  assetsLoading.value = false;
}

// ─── Input handlers ───────────────────────────────────────
function onBodyInput(event: Event) {
  const target = event.target as HTMLTextAreaElement;
  previewBody.value = target.value;
  rebuildRawContent();
}

function onNameInput(event: Event) {
  const val = (event.target as HTMLInputElement).value;
  if (previewFrontmatter.value) {
    previewFrontmatter.value = { ...previewFrontmatter.value, name: val };
    rebuildRawContent();
  }
}

function onDescInput(event: Event) {
  const val = (event.target as HTMLTextAreaElement).value;
  if (previewFrontmatter.value) {
    previewFrontmatter.value = { ...previewFrontmatter.value, description: val };
    rebuildRawContent();
  }
}

// ─── Actions ──────────────────────────────────────────────
async function handleSave() {
  saving.value = true;
  const ok = await store.updateSkillRaw(skillDir.value, rawContent.value);
  if (ok) {
    editorDirty.value = false;
    lastSaved.value = new Date();
    await loadSkill();
  }
  saving.value = false;
}

async function handleDelete() {
  const { confirmed } = await showConfirm({
    title: "Delete Skill",
    message: "Delete this skill? This cannot be undone.",
    variant: "danger",
    confirmLabel: "Delete",
  });
  if (!confirmed) return;
  deleting.value = true;
  const ok = await store.deleteSkill(skillDir.value);
  deleting.value = false;
  if (ok) {
    router.push({ name: "skills-manager" });
  }
}

async function handleDiscard() {
  if (!editorDirty.value) return;
  const { confirmed } = await showConfirm({
    title: "Discard Changes",
    message: "Discard all unsaved changes?",
    variant: "warning",
    confirmLabel: "Discard",
  });
  if (!confirmed) return;
  loadSkill();
}

async function handleAddAsset() {
  const path = await browseForFile({
    title: "Select asset file to add",
    filters: [{ name: "All Files", extensions: ["*"] }],
  });
  if (!path) return;
  const name = path.split(/[\\/]/).pop() || path;
  const ok = await store.copyAssetFrom(skillDir.value, name, path);
  if (ok) await loadAssets();
}

async function handleNewFile(name: string) {
  if (!name.trim()) return;
  const ok = await store.addAsset(skillDir.value, name.trim(), []);
  if (ok) await loadAssets();
}

async function handleRemoveAsset(assetPath: string) {
  const { confirmed } = await showConfirm({
    title: "Remove Asset",
    message: `Remove asset "${assetPath}"?`,
    variant: "danger",
    confirmLabel: "Remove",
  });
  if (!confirmed) return;
  const ok = await store.removeAsset(skillDir.value, assetPath);
  if (ok) await loadAssets();
}

async function handleViewAsset(asset: SkillAsset) {
  viewingAsset.value = asset;
  viewingContent.value = null;
  if (!asset.isDirectory) {
    const content = await store.readAsset(skillDir.value, asset.path);
    viewingContent.value = content;
  }
}

/** Open a relative path referenced in the markdown preview as an asset popup. */
async function handlePreviewLinkClick(href: string) {
  // Normalize: strip leading ./
  const normalized = href.replace(/^\.\//, "");

  // Find matching asset in the loaded assets list
  const matchingAsset = assets.value.find(
    (a) => a.path === normalized || a.path.endsWith(`/${normalized}`) || a.name === normalized,
  );

  if (matchingAsset) {
    await handleViewAsset(matchingAsset);
  } else {
    // Asset not in the tree — try reading it directly as a relative path
    viewingAsset.value = {
      name: normalized.split("/").pop() ?? normalized,
      path: normalized,
      isDirectory: false,
      sizeBytes: 0,
    };
    viewingContent.value = null;
    const content = await store.readAsset(skillDir.value, normalized);
    viewingContent.value = content;
  }
}

/** Handle clicks in the preview markdown area for relative links (asset references). */
function handlePreviewClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (!href) return;

  // External/anchor links — handled by MarkdownContent's @open-external emit
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) return;

  // Relative links — open as asset preview
  event.preventDefault();
  event.stopPropagation();
  handlePreviewLinkClick(href);
}

function goBack() {
  router.push({ name: "skills-manager" });
}

// ─── Markdown toolbar ─────────────────────────────────────
function insertMarkdown(prefix: string, suffix = "") {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const scrollPos = el.scrollTop;
  const text = el.value;
  const selected = text.substring(start, end);
  const inner = selected || "text";
  const replacement = prefix + inner + suffix;
  previewBody.value = text.substring(0, start) + replacement + text.substring(end);
  rebuildRawContent();
  nextTick(() => {
    el.focus();
    const selStart = start + prefix.length;
    const selEnd = selStart + inner.length;
    el.setSelectionRange(selStart, selEnd);
    el.scrollTop = scrollPos;
  });
}

function insertBold() {
  insertMarkdown("**", "**");
}
function insertItalic() {
  insertMarkdown("*", "*");
}
function insertH1() {
  insertMarkdown("\n# ");
}
function insertH2() {
  insertMarkdown("\n## ");
}
function insertBulletList() {
  insertMarkdown("\n- ");
}
function insertCode() {
  insertMarkdown("`", "`");
}
function insertLink() {
  insertMarkdown("[", "](url)");
}

// ─── Utilities ────────────────────────────────────────────
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function syncScroll() {
  if (editorRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = editorRef.value.scrollTop;
  }
}
</script>

<template>
  <div class="editor-shell">
    <!-- ═══ Top Bar ═══ -->
    <header class="editor-topbar">
      <button class="topbar-back" @click="goBack">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 12L6 8l4-4"/></svg>
        Back to Skills
      </button>
      <div class="topbar-divider" />
      <div v-if="store.selectedSkill" class="topbar-skill-name">
        <span class="skill-icon-sm">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l3 2"/></svg>
        </span>
        {{ store.selectedSkill.frontmatter.name || 'Skill' }}
      </div>
      <div v-if="store.selectedSkill" class="topbar-meta">
        <SkillScopeBadge :scope="store.selectedSkill.scope" />
        <span v-if="editorDirty" class="status-modified">Modified</span>
      </div>
      <div class="topbar-actions">
        <span class="kbd-hint">
          <span class="kbd">Ctrl</span>+<span class="kbd">S</span>
        </span>
        <button class="btn-ghost" :disabled="!editorDirty" @click="handleDiscard">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 2l12 12M14 2L2 14"/></svg>
          Discard
        </button>
        <button class="btn-primary" :disabled="!editorDirty || saving" @click="handleSave">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V5.5L12 2z"/><path d="M10 2v4H6"/><path d="M6 10h4"/></svg>
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </header>

    <!-- Error -->
    <div v-if="store.error" class="error-bar">{{ store.error }}</div>

    <!-- Loading -->
    <div v-if="!store.selectedSkill && !store.error" class="state-message">
      Loading skill…
    </div>

    <!-- ═══ Editor Body ═══ -->
    <template v-if="store.selectedSkill">
      <div
        ref="containerRef"
        class="editor-body"
        :class="{ 'is-dragging': dragging }"
        :style="{ gridTemplateColumns: `${leftWidth}% 5px 1fr` }"
      >
        <!-- LEFT: Editor Panel -->
        <div class="panel panel-left">
          <div class="panel-header">
            <span class="panel-header-title">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V3a1 1 0 00-1-1z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>
              Editor
            </span>
            <span class="panel-header-filename">SKILL.md</span>
          </div>

          <div class="panel-scroll">
            <!-- Frontmatter Card -->
            <div v-if="previewFrontmatter" class="frontmatter-section">
              <div class="frontmatter-card">
                <div class="frontmatter-header">
                  <span class="frontmatter-label">
                    Frontmatter
                    <span class="yaml-tag">YAML</span>
                  </span>
                </div>
                <div class="frontmatter-body">
                  <div class="field-group">
                    <label class="field-label">Name</label>
                    <input
                      type="text"
                      class="field-input field-input--mono"
                      :value="previewFrontmatter.name"
                      spellcheck="false"
                      @input="onNameInput"
                    />
                  </div>
                  <div class="field-group">
                    <label class="field-label">Description</label>
                    <textarea
                      class="field-textarea"
                      rows="3"
                      :value="previewFrontmatter.description"
                      @input="onDescInput"
                    />
                    <div class="field-footer">
                      <span />
                      <span class="char-count" :class="descCharClass">
                        {{ descCharCount }} / 1024
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Markdown Editor -->
            <div class="instructions-section">
              <div class="instructions-header">
                <span class="instructions-label">Instructions</span>
                <span class="instructions-hint">Markdown supported</span>
              </div>
              <div class="md-toolbar">
                <button class="md-toolbar-btn" title="Bold" @click="insertBold">
                  <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2h5a3 3 0 011.5 5.6A3.5 3.5 0 019.5 14H4V2zm2 5h3a1 1 0 100-2H6v2zm0 2v3h3.5a1.5 1.5 0 000-3H6z"/></svg>
                </button>
                <button class="md-toolbar-btn" title="Italic" @click="insertItalic">
                  <svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 2h6v2h-2.2l-2.6 8H9v2H3v-2h2.2l2.6-8H6V2z"/></svg>
                </button>
                <div class="md-toolbar-sep" />
                <button class="md-toolbar-btn md-toolbar-btn--text" title="H1" @click="insertH1">H1</button>
                <button class="md-toolbar-btn md-toolbar-btn--text-sm" title="H2" @click="insertH2">H2</button>
                <div class="md-toolbar-sep" />
                <button class="md-toolbar-btn" title="Bullet List" @click="insertBulletList">
                  <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm0 5a1 1 0 100-2 1 1 0 000 2zm3-11h10v1H5V3zm0 5h10v1H5V8zm0 5h10v1H5v-1z"/></svg>
                </button>
                <div class="md-toolbar-sep" />
                <button class="md-toolbar-btn" title="Code" @click="insertCode">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4L1 8l4 4M11 4l4 4-4 4"/></svg>
                </button>
                <button class="md-toolbar-btn" title="Link" @click="insertLink">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.5 9.5a3 3 0 004 .5l2-2a3 3 0 00-4.24-4.24l-1.14 1.14"/><path d="M9.5 6.5a3 3 0 00-4-.5l-2 2a3 3 0 004.24 4.24l1.14-1.14"/></svg>
                </button>
              </div>

              <div class="md-editor-wrap">
                <div ref="lineNumbersRef" class="line-numbers" aria-hidden="true">
                  <span v-for="n in editorLineNumbers" :key="n" class="ln">{{ n }}</span>
                </div>
                <textarea
                  ref="editorRef"
                  class="md-textarea"
                  :value="previewBody"
                  spellcheck="false"
                  @input="onBodyInput"
                  @scroll="syncScroll"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Resize Handle -->
        <div
          class="resize-handle"
          :class="{ active: dragging }"
          @mousedown="onMouseDown"
        />

        <!-- RIGHT: Preview Panel -->
        <div class="panel panel-right">
          <div class="panel-header">
            <span class="panel-header-title">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/></svg>
              Preview
            </span>
          </div>

          <div class="panel-scroll">
            <div class="preview-content">
              <!-- Preview Frontmatter Card -->
              <div v-if="previewFrontmatter" class="preview-frontmatter">
                <div class="preview-skill-name">
                  <span class="name-icon">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><path d="M8 4v4l3 2"/></svg>
                  </span>
                  {{ previewFrontmatter.name || 'Untitled Skill' }}
                </div>
                <div v-if="previewFrontmatter.description" class="preview-skill-desc">
                  {{ previewFrontmatter.description }}
                </div>
                <div class="preview-skill-meta">
                  <SkillScopeBadge :scope="store.selectedSkill!.scope" />
                  <span class="badge badge-neutral">
                    ~{{ store.selectedSkill!.estimatedTokens.toLocaleString() }} tokens
                  </span>
                </div>
              </div>

              <!-- Rendered Markdown -->
              <div class="preview-markdown" @click="handlePreviewClick">
                <MarkdownContent :content="previewBody" @open-external="openExternal" />
              </div>
            </div>

            <!-- Assets Section -->
            <div class="assets-section">
              <SkillAssetsTree
                :assets="assets"
                :loading="assetsLoading"
                @add-asset="handleAddAsset"
                @new-file="(name: string) => handleNewFile(name)"
                @remove-asset="handleRemoveAsset"
                @view-asset="handleViewAsset"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Status Bar ═══ -->
      <div class="editor-info-bar">
        <div class="info-group">
          <span class="info-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 2h5l4 4v7a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"/></svg>
            {{ store.selectedSkill.directory }}/SKILL.md
          </span>
          <span class="info-item">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/></svg>
            {{ lastSavedDisplay }}
          </span>
        </div>
        <div class="info-group">
          <span class="info-item">UTF-8</span>
          <span class="info-item">{{ totalLineCount }} lines</span>
          <span class="info-item">{{ byteCount.toLocaleString() }} bytes</span>
        </div>
      </div>
    </template>

    <!-- Asset Preview Modal -->
    <div v-if="viewingAsset" class="asset-preview-overlay" @click.self="viewingAsset = null">
      <div class="asset-preview-modal">
        <div class="asset-preview-header">
          <span class="asset-preview-title">{{ viewingAsset.name }}</span>
          <button class="asset-preview-close" @click="viewingAsset = null">✕</button>
        </div>
        <div class="asset-preview-body">
          <div class="asset-preview-meta">
            <span>Size: {{ formatSize(viewingAsset.sizeBytes) }}</span>
            <span>Path: {{ viewingAsset.path }}</span>
          </div>
          <div v-if="viewingContent !== null" class="asset-preview-content">
            <pre>{{ viewingContent }}</pre>
          </div>
          <div v-else class="asset-preview-no-content">
            <p>Unable to read file content</p>
            <p class="asset-preview-hint">The file may be binary or could not be read as text.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ═══════════════════════════════════════════════════════════
   SKILL EDITOR — Full-height IDE-like layout
   ═══════════════════════════════════════════════════════════ */

/* ── Shell ──────────────────────────────────────────────── */
.editor-shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--canvas-default);
  color: var(--text-primary);
  overflow: hidden;
}

/* ── Top Bar ────────────────────────────────────────────── */
.editor-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  height: 52px;
  min-height: 52px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
  z-index: 10;
}

.topbar-back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-tertiary);
  font-size: 0.8125rem;
  font-weight: 500;
  text-decoration: none;
  padding: 5px 10px 5px 6px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  cursor: pointer;
  border: none;
  background: none;
  font-family: inherit;
}

.topbar-back:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

.topbar-back svg {
  width: 16px;
  height: 16px;
}

.topbar-divider {
  width: 1px;
  height: 24px;
  background: var(--border-default);
  flex-shrink: 0;
}

.topbar-skill-name {
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-icon-sm {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  background: var(--success-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--success-fg);
  font-size: 12px;
  flex-shrink: 0;
}

.topbar-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 4px;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.status-modified {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--warning-fg);
}

.status-modified::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warning-fg);
  animation: pulse-dot 2s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.kbd-hint {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  margin-right: 4px;
}

.kbd {
  display: inline-block;
  padding: 1px 5px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--canvas-subtle);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  line-height: 1.4;
}

/* ── Buttons ────────────────────────────────────────────── */
.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}

.btn-ghost:hover:not(:disabled) {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.btn-ghost:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-ghost--sm {
  padding: 4px 10px;
  font-size: 0.6875rem;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent-emphasis);
  color: #fff;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
  white-space: nowrap;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Error & State ──────────────────────────────────────── */
.error-bar {
  padding: 10px 20px;
  background: var(--danger-muted);
  color: var(--danger-fg);
  font-size: 0.8125rem;
  flex-shrink: 0;
}

.state-message {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* ── Editor Body ────────────────────────────────────────── */
.editor-body {
  display: grid;
  grid-template-columns: 1fr 5px 1fr;
  flex: 1;
  overflow: hidden;
  min-height: 0;
  position: relative;
}

.editor-body.is-dragging {
  cursor: col-resize;
  user-select: none;
}

/* ── Panels ─────────────────────────────────────────────── */
.panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.panel-left {
  border-right: 1px solid var(--border-default);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 20px;
  height: 40px;
  min-height: 40px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
}

.panel-header-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.panel-header-title svg {
  width: 13px;
  height: 13px;
  opacity: 0.6;
}

.panel-header-filename {
  font-size: 0.625rem;
  color: var(--text-placeholder);
  font-family: var(--font-mono);
}

.panel-scroll {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  min-height: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}

.panel-scroll::-webkit-scrollbar {
  width: 5px;
}

.panel-scroll::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-full);
}

/* ── Resize Handle ──────────────────────────────────────── */
.resize-handle {
  cursor: col-resize;
  z-index: 5;
  transition: background var(--transition-fast);
  background: var(--border-default);
}

.resize-handle:hover,
.resize-handle.active {
  background: var(--accent-emphasis);
}

/* ── Frontmatter Card ───────────────────────────────────── */
.frontmatter-section {
  padding: 20px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.frontmatter-card {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
  position: relative;
}

.frontmatter-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent-emphasis), transparent);
  opacity: 0.5;
}

.frontmatter-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-subtle);
}

.frontmatter-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.yaml-tag {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: var(--accent-fg);
  background: var(--accent-subtle);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-weight: 500;
}

.frontmatter-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-label {
  font-size: 0.6875rem;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
}

.field-input {
  width: 100%;
  padding: 8px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  transition: all var(--transition-fast);
}

.field-input--mono {
  font-family: var(--font-mono);
}

.field-input:focus {
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.field-textarea {
  width: 100%;
  padding: 8px 12px;
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: inherit;
  outline: none;
  resize: vertical;
  min-height: 60px;
  line-height: 1.55;
  transition: all var(--transition-fast);
}

.field-textarea:focus {
  border-color: var(--accent-emphasis);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
}

.field-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.char-count {
  font-size: 0.625rem;
  font-family: var(--font-mono);
  color: var(--text-placeholder);
  font-variant-numeric: tabular-nums;
}

.char-count.near-limit {
  color: var(--warning-fg);
}

.char-count.at-limit {
  color: var(--danger-fg);
}

/* ── Instructions / Markdown Editor ─────────────────────── */
.instructions-section {
  flex: 1 0 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.instructions-header {
  padding: 16px 20px 6px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.instructions-label {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.instructions-hint {
  font-size: 0.625rem;
  color: var(--text-placeholder);
}

/* ── Markdown Toolbar ───────────────────────────────────── */
.md-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 20px;
  border-bottom: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
}

.md-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
  font-family: inherit;
}

.md-toolbar-btn:hover {
  background: var(--neutral-subtle);
  color: var(--text-primary);
}

.md-toolbar-btn svg {
  width: 15px;
  height: 15px;
}

.md-toolbar-btn--text {
  font-size: 0.75rem;
  font-weight: 700;
}

.md-toolbar-btn--text-sm {
  font-size: 0.6875rem;
  font-weight: 600;
}

.md-toolbar-sep {
  width: 1px;
  height: 18px;
  background: var(--border-default);
  margin: 0 4px;
}

/* ── Editor Wrap ────────────────────────────────────────── */
.md-editor-wrap {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.line-numbers {
  width: 44px;
  min-width: 44px;
  padding: 16px 0;
  background: var(--canvas-inset);
  border-right: 1px solid var(--border-subtle);
  text-align: right;
  user-select: none;
  overflow: hidden;
  flex-shrink: 0;
}

.ln {
  display: block;
  padding: 0 10px 0 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 24px;
  color: var(--text-placeholder);
  height: 24px;
}

.md-textarea {
  flex: 1;
  padding: 16px 20px;
  background: var(--canvas-default);
  border: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 24px;
  outline: none;
  resize: none;
  tab-size: 2;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-default) transparent;
}

.md-textarea::-webkit-scrollbar {
  width: 5px;
}

.md-textarea::-webkit-scrollbar-thumb {
  background: var(--border-default);
  border-radius: var(--radius-full);
}

/* ── Preview Panel ──────────────────────────────────────── */
.preview-content {
  padding: 24px;
}

.preview-frontmatter {
  background: var(--canvas-raised);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 28px;
  position: relative;
  overflow: hidden;
}

.preview-frontmatter::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(135deg, var(--accent-emphasis), var(--accent-fg));
}

.preview-skill-name {
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.name-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--success-emphasis), var(--success-fg));
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 15px;
  box-shadow: 0 2px 10px rgba(5, 150, 105, 0.3);
  flex-shrink: 0;
}

.preview-skill-desc {
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary);
  margin-left: 42px;
}

.preview-skill-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  margin-left: 42px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.4;
}

.badge-neutral {
  background: var(--neutral-muted);
  color: var(--text-secondary);
}

/* ── Preview Markdown ───────────────────────────────────── */
.preview-markdown {
  line-height: 1.7;
}

.preview-markdown :deep(h1) {
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
  margin: 0 0 16px !important;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-default);
}

.preview-markdown :deep(h2) {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--accent-fg);
  margin: 24px 0 10px !important;
}

.preview-markdown :deep(ul),
.preview-markdown :deep(ol) {
  padding-left: 20px !important;
  margin: 8px 0 !important;
}

.preview-markdown :deep(li) {
  font-size: 0.875rem;
  line-height: 1.8;
  color: var(--text-secondary);
}

.preview-markdown :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  background: var(--neutral-subtle);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--accent-fg);
}

.preview-markdown :deep(pre) {
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px 16px;
  margin: 10px 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  color: var(--text-secondary);
  overflow-x: auto;
}

.preview-markdown :deep(pre code) {
  background: none;
  padding: 0;
  color: inherit;
}

.preview-markdown :deep(p) {
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.7;
}

.preview-markdown :deep(a) {
  color: var(--accent-fg);
  text-decoration: none;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: border-color var(--transition-fast);
}

.preview-markdown :deep(a:hover) {
  border-bottom-color: var(--accent-fg);
}

/* ── Assets Section ─────────────────────────────────────── */
.assets-section {
  border-top: 1px solid var(--border-default);
  padding: 20px 24px;
}

.assets-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.assets-title {
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.assets-title .count {
  background: var(--neutral-muted);
  color: var(--text-secondary);
  padding: 0 6px;
  border-radius: var(--radius-full);
  font-size: 0.625rem;
  font-variant-numeric: tabular-nums;
}

.assets-loading {
  font-size: 0.8125rem;
  color: var(--text-tertiary);
  text-align: center;
  padding: 16px 0;
}

.asset-file {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  background: var(--canvas-raised);
  border: 1px solid var(--border-subtle);
  margin-bottom: 6px;
  transition: all var(--transition-fast);
  cursor: default;
}

.asset-file:hover {
  border-color: var(--border-default);
  background: var(--canvas-overlay);
}

.asset-file--nested {
  margin-left: 16px;
}

.asset-icon {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}

.asset-icon.md {
  background: var(--accent-muted);
  color: var(--accent-fg);
}

.asset-icon.ref {
  background: var(--done-muted, var(--success-muted));
  color: var(--done-fg, var(--success-fg));
}

.asset-name {
  flex: 1;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-primary);
  font-family: var(--font-mono);
}

.asset-size {
  font-size: 0.6875rem;
  color: var(--text-placeholder);
  font-variant-numeric: tabular-nums;
}

.asset-remove {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.75rem;
  padding: 2px 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast);
}

.asset-file:hover .asset-remove {
  opacity: 1;
}

.asset-remove:hover {
  color: var(--danger-fg);
  background: var(--danger-muted);
}

.asset-folder {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 2px 12px;
  font-size: 0.6875rem;
  color: var(--text-tertiary);
  font-weight: 500;
}

.asset-folder svg {
  width: 13px;
  height: 13px;
  opacity: 0.5;
}

.drop-zone-sm {
  border: 1.5px dashed var(--border-default);
  border-radius: var(--radius-md);
  padding: 16px;
  text-align: center;
  color: var(--text-placeholder);
  font-size: 0.75rem;
  margin-top: 8px;
  transition: all var(--transition-fast);
  cursor: pointer;
}

.drop-zone-sm:hover {
  border-color: var(--accent-emphasis);
  color: var(--accent-fg);
  background: var(--accent-subtle);
}

.drop-zone-browse {
  color: var(--accent-fg);
  cursor: pointer;
}

/* ── Status Bar ─────────────────────────────────────────── */
.editor-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 20px;
  border-top: 1px solid var(--border-default);
  background: var(--canvas-subtle);
  flex-shrink: 0;
  font-size: 0.625rem;
  color: var(--text-placeholder);
}

.info-group {
  display: flex;
  align-items: center;
  gap: 14px;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.info-item svg {
  width: 11px;
  height: 11px;
  opacity: 0.5;
}

/* ── Asset clickable names ─────────────────────────────── */
.asset-name--clickable {
  cursor: pointer;
  transition: color var(--transition-fast);
}

.asset-name--clickable:hover {
  color: var(--accent-fg);
  text-decoration: underline;
}

/* ── Asset Preview Modal ───────────────────────────────── */
.asset-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.asset-preview-modal {
  background: var(--canvas-default);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg, 12px);
  width: min(680px, 90vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.25);
}

.asset-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.asset-preview-title {
  font-size: 0.8125rem;
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.asset-preview-close {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.asset-preview-close:hover {
  color: var(--text-primary);
  background: var(--neutral-subtle);
}

.asset-preview-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.asset-preview-meta {
  display: flex;
  gap: 20px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-bottom: 16px;
  font-family: var(--font-mono);
}

.asset-preview-content {
  background: var(--canvas-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 16px;
  overflow: auto;
  max-height: 50vh;
}

.asset-preview-content pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}

.asset-preview-no-content {
  font-size: 0.8125rem;
  color: var(--text-placeholder);
  font-style: italic;
  padding: 20px 0;
  text-align: center;
}

.asset-preview-no-content p {
  margin: 0;
}

.asset-preview-hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 4px;
}
</style>
