import type { SkillAsset, SkillFrontmatter } from "@tracepilot/types";
import { formatBytes } from "@tracepilot/types";
import { useConfirmDialog, useResizeHandle } from "@tracepilot/ui";
import {
  computed,
  type InjectionKey,
  inject,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from "vue-router";
import { useSkillMarkdownToolbar } from "@/composables/skillEditor/markdownToolbar";
import { browseForFile } from "@/composables/useBrowseDirectory";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useSkillsStore } from "@/stores/skills";
import { logWarn } from "@/utils/logger";
import {
  estimateSkillTokenUsage,
  getSkillFrontmatterYaml,
  parseSkillContent,
  patchSkillFrontmatter,
  replaceSkillBody,
} from "@/utils/skillFrontmatter";

/** Shared state and actions provided by SkillEditorView to its children. */

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
  const {
    leftWidth,
    minLeftWidth,
    maxLeftWidth,
    dragging,
    containerRef,
    onMouseDown,
    onKeyDown: onResizeKeyDown,
  } = useResizeHandle({
    minPct: 25,
    maxPct: 75,
    initial: 50,
    minPanePx: 300,
    splitterPx: 5,
  });

  // ─── Computed ─────────────────────────────────────────────
  const skillDir = computed(() => {
    const param = route.params.name;
    return typeof param === "string" ? decodeURIComponent(param) : "";
  });
  const returnSessionId = computed(() => {
    const fromSession = route.query.fromSession;
    return typeof fromSession === "string" && fromSession.trim() ? fromSession : "";
  });
  const backLabel = computed(() => (returnSessionId.value ? "Back to Session" : "Back to Skills"));
  const isReadOnly = computed(() => store.selectedSkill?.scope === "builtin");

  const editorLineNumbers = computed(() => {
    const count = previewBody.value.split("\n").length;
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  const totalLineCount = computed(() => rawContent.value.split("\n").length);
  const byteCount = computed(() => new TextEncoder().encode(rawContent.value).length);
  const tokenUsage = computed(() => estimateSkillTokenUsage(rawContent.value));
  const rawFrontmatter = computed(() => getSkillFrontmatterYaml(rawContent.value));

  const descCharCount = computed(() => previewFrontmatter.value?.description?.length ?? 0);
  const descCharClass = computed(() => {
    if (descCharCount.value >= 1024) return "at-limit";
    if (descCharCount.value >= 900) return "near-limit";
    return "";
  });

  const lastSavedDisplay = computed(() => {
    if (editorDirty.value) return "Unsaved changes";
    if (!lastSaved.value) return "Saved";
    const diff = Math.floor((Date.now() - lastSaved.value.getTime()) / 1000);
    if (diff < 10) return "Just saved";
    if (diff < 60) return `Saved ${diff}s ago`;
    const mins = Math.floor(diff / 60);
    return `Saved ${mins} min ago`;
  });

  // Guard all navigation paths, including the sidebar and history, rather than
  // protecting only the editor's Back button. Share a pending decision so rapid
  // navigation cannot replace an already-open confirmation.
  let pendingNavigation: Promise<boolean> | null = null;
  function confirmNavigation(): boolean | Promise<boolean> {
    if (!editorDirty.value || isReadOnly.value) return true;
    if (!pendingNavigation) {
      pendingNavigation = showConfirm({
        title: "Unsaved Skill Changes",
        message: "Leave this skill and discard your unsaved changes?",
        variant: "warning",
        confirmLabel: "Discard and Leave",
        cancelLabel: "Keep Editing",
      })
        .then(({ confirmed }) => confirmed)
        .finally(() => {
          pendingNavigation = null;
        });
    }
    return pendingNavigation;
  }
  onBeforeRouteLeave(confirmNavigation);
  onBeforeRouteUpdate((to, from) =>
    to.params.name === from.params.name ? true : confirmNavigation(),
  );

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
      if (!isReadOnly.value && editorDirty.value && !saving.value) handleSave();
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

  function markRawContent(nextContent: string) {
    rawContent.value = nextContent;
    parseContent(nextContent);
    editorDirty.value = true;
  }

  async function loadAssets() {
    assetsLoading.value = true;
    assets.value = await store.listAssets(skillDir.value);
    assetsLoading.value = false;
  }

  // ─── Input handlers ───────────────────────────────────────
  function onBodyInput(event: Event) {
    if (isReadOnly.value) return;
    const target = event.target as HTMLTextAreaElement;
    markRawContent(replaceSkillBody(rawContent.value, target.value));
  }

  function onNameInput(event: Event) {
    if (isReadOnly.value) return;
    const val = (event.target as HTMLInputElement).value;
    if (previewFrontmatter.value) {
      markRawContent(patchSkillFrontmatter(rawContent.value, { name: val }));
    }
  }

  function onDescInput(event: Event) {
    if (isReadOnly.value) return;
    const val = (event.target as HTMLTextAreaElement).value;
    if (previewFrontmatter.value) {
      markRawContent(patchSkillFrontmatter(rawContent.value, { description: val }));
    }
  }

  function onFrontmatterTextInput(key: "argument-hint" | "allowed-tools", event: Event) {
    if (isReadOnly.value) return;
    const value = (event.target as HTMLInputElement).value;
    markRawContent(patchSkillFrontmatter(rawContent.value, { [key]: value }));
  }

  function onFrontmatterBooleanInput(
    key: "user-invocable" | "disable-model-invocation",
    event: Event,
  ) {
    if (isReadOnly.value) return;
    const checked = (event.target as HTMLInputElement).checked;
    markRawContent(patchSkillFrontmatter(rawContent.value, { [key]: checked }));
  }

  function onAutomaticInvocationInput(event: Event) {
    if (isReadOnly.value) return;
    const allowAutomaticUse = (event.target as HTMLInputElement).checked;
    markRawContent(
      patchSkillFrontmatter(rawContent.value, {
        "disable-model-invocation": !allowAutomaticUse,
      }),
    );
  }

  // ─── Actions ──────────────────────────────────────────────
  async function handleSave() {
    if (isReadOnly.value) return;
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
    if (isReadOnly.value) return;
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
      editorDirty.value = false;
      pushRoute(router, ROUTE_NAMES.skillsManager);
    }
  }

  async function handleDiscard() {
    if (isReadOnly.value) return;
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
    if (isReadOnly.value) return;
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
    if (isReadOnly.value) return;
    if (!name.trim()) return;
    const ok = await store.addAsset(skillDir.value, name.trim(), []);
    if (ok) await loadAssets();
  }

  async function handleRemoveAsset(assetPath: string) {
    if (isReadOnly.value) return;
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
    const matchingAsset = assets.value.find((asset) => {
      const path = asset.path.replace(/\\/g, "/");
      return path === normalized || path.endsWith(`/${normalized}`) || asset.name === normalized;
    });

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
    if (returnSessionId.value) {
      pushRoute(router, ROUTE_NAMES.sessionConversation, {
        params: { id: returnSessionId.value },
      });
      return;
    }
    pushRoute(router, ROUTE_NAMES.skillsManager);
  }

  // ─── Markdown toolbar ─────────────────────────────────────
  const { insertBold, insertItalic, insertH1, insertH2, insertBulletList, insertCode, insertLink } =
    useSkillMarkdownToolbar(editorRef, isReadOnly, (body) => {
      markRawContent(replaceSkillBody(rawContent.value, body));
    });

  // ─── Utilities ────────────────────────────────────────────
  function formatSize(bytes: number): string {
    return formatBytes(bytes);
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
    store,
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
    leftWidth,
    minLeftWidth,
    maxLeftWidth,
    dragging,
    containerRef,
    onMouseDown,
    onResizeKeyDown,
    skillDir,
    editorLineNumbers,
    totalLineCount,
    byteCount,
    tokenUsage,
    rawFrontmatter,
    descCharCount,
    descCharClass,
    lastSavedDisplay,
    backLabel,
    isReadOnly,
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
    onFrontmatterTextInput,
    onFrontmatterBooleanInput,
    onAutomaticInvocationInput,
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
