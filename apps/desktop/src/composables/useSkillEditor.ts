import type { SkillAsset, SkillFrontmatter } from "@tracepilot/types";
import { useConfirmDialog, useResizeHandle } from "@tracepilot/ui";
import {
  computed,
  type InjectionKey,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { browseForFile } from "@/composables/useBrowseDirectory";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useSkillsStore } from "@/stores/skills";
import { logWarn } from "@/utils/logger";
import { parseSkillContent, serializeSkillContent } from "@/utils/skillFrontmatter";

/**
 * State + actions for `SkillEditorView`.
 *
 * Extracted from `views/skills/SkillEditorView.vue` in Wave 36. Behaviour is
 * preserved byte-for-byte; the shell provides a single instance of this
 * composable which the children consume via `provide`/`inject`
 * (`SkillEditorKey` + `useSkillEditorContext`).
 */

export function useSkillEditor() {
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
      pushRoute(router, ROUTE_NAMES.skillsManager);
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
    pushRoute(router, ROUTE_NAMES.skillsManager);
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

  function closeAssetPreview() {
    viewingAsset.value = null;
  }

  return reactive({
    // store passthrough
    store,
    // state
    saving,
    deleting,
    rawContent,
    assets,
    assetsLoading,
    editorDirty,
    lastSaved,
    editorRef,
    lineNumbersRef,
    viewingAsset,
    viewingContent,
    previewFrontmatter,
    previewBody,
    // resize
    leftWidth,
    dragging,
    containerRef,
    onMouseDown,
    // computed
    skillDir,
    editorLineNumbers,
    totalLineCount,
    byteCount,
    descCharCount,
    descCharClass,
    lastSavedDisplay,
    // actions
    loadSkill,
    handleSave,
    handleDelete,
    handleDiscard,
    handleAddAsset,
    handleNewFile,
    handleRemoveAsset,
    handleViewAsset,
    handlePreviewClick,
    goBack,
    onBodyInput,
    onNameInput,
    onDescInput,
    insertBold,
    insertItalic,
    insertH1,
    insertH2,
    insertBulletList,
    insertCode,
    insertLink,
    formatSize,
    syncScroll,
    closeAssetPreview,
  });
}

export type SkillEditorContext = ReturnType<typeof useSkillEditor>;
export const SkillEditorKey: InjectionKey<SkillEditorContext> = Symbol("SkillEditorKey");

export function useSkillEditorContext(): SkillEditorContext {
  const ctx = inject(SkillEditorKey);
  if (!ctx) {
    throw new Error("useSkillEditorContext must be used within a SkillEditorView");
  }
  return ctx;
}
