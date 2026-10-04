import { skillsUsageDetail } from "@tracepilot/client";
import type { SkillAsset, SkillFrontmatter, SkillUsageDetail } from "@tracepilot/types";
import { formatBytes } from "@tracepilot/types";
import { runAction, useAsyncGuard, useConfirmDialog, useResizeHandle } from "@tracepilot/ui";
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
import { useRoute, useRouter } from "vue-router";
import { useSkillAssetPreview } from "@/composables/definitionEditor/useSkillAssetPreview";
import { useUnsavedChangesGuard } from "@/composables/definitionEditor/useUnsavedChangesGuard";
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
import { rangeBounds } from "@/utils/usage/range";

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

  const definitionGuard = useAsyncGuard();
  const assetsGuard = useAsyncGuard();
  let disposed = false;
  let draftVersion = 0;
  watch(
    rawContent,
    () => {
      draftVersion++;
    },
    { flush: "sync" },
  );

  const previewFrontmatter = ref<SkillFrontmatter | null>(null);
  const previewBody = ref("");

  // Usage loads independently of the file, so a skill with no index rows
  // still opens and edits normally.
  // `?tab=usage` opens straight on Usage, so a link from the dashboard or a
  // conversation lands on the figures rather than on the file.
  const activeTab = ref<"preview" | "usage">(route.query.tab === "usage" ? "usage" : "preview");
  const usage = ref<SkillUsageDetail | null>(null);
  const usageLoading = ref(false);
  const usageError = ref<string | null>(null);
  const usageGuard = useAsyncGuard();

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
  const { viewingAsset, viewingContent, handleViewAsset, handlePreviewClick, closeAssetPreview } =
    useSkillAssetPreview(skillDir, assets, store.readAsset);
  const isUsageOnly = computed(() => skillDir.value.startsWith("name:"));
  const skillName = computed(() =>
    isUsageOnly.value
      ? skillDir.value.slice(5)
      : store.selectedSkill?.directory === skillDir.value
        ? store.selectedSkill.frontmatter.name
        : "",
  );
  const returnSessionId = computed(() => {
    const fromSession = route.query.fromSession;
    return typeof fromSession === "string" && fromSession.trim() ? fromSession : "";
  });
  const backLabel = computed(() => (returnSessionId.value ? "Back to Session" : "Back to Skills"));
  const isReadOnly = computed(() => isUsageOnly.value || store.selectedSkill?.scope === "builtin");
  /** The manager's range, so both pages describe the same window. */
  const usageRange = computed(() => store.range);
  /**
   * Fingerprint of the file as saved, for the drift notice. It comes from the
   * catalog rather than the open draft, so an unsaved edit never reads as
   * drift against past usage.
   */
  const installedSkill = computed(() =>
    store.skills.find((skill) => skill.directory === skillDir.value),
  );
  const installedSha256 = computed(() => installedSkill.value?.contentSha256 ?? null);
  /** Body-only fingerprint, which newer CLIs record at invocation. */
  const installedBodySha256 = computed(() => installedSkill.value?.bodySha256 ?? null);

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

  useUnsavedChangesGuard({
    isDirty: () => editorDirty.value && !isReadOnly.value,
    title: "Unsaved Skill Changes",
    message: "Leave this skill and discard your unsaved changes?",
    isSameDocument: (to, from) => to.params.name === from.params.name,
  });

  // ─── Lifecycle ────────────────────────────────────────────
  onMounted(async () => {
    document.addEventListener("keydown", handleKeydown);
    if (skillDir.value) await loadSkill();
    if (!disposed && store.skills.length === 0) store.loadSkills();
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", handleKeydown);
    disposed = true;
    definitionGuard.invalidate();
    assetsGuard.invalidate();
    usageGuard.invalidate();
  });

  watch(skillDir, async () => {
    lastSaved.value = null;
    await loadSkill();
  });

  // The skill's own name identifies its usage; the directory does not,
  // because the two can disagree. This follows the *saved* name rather than
  // the draft, so typing in the name field does not re-query the index.
  watch(
    [skillName, usageRange],
    ([name]) => {
      usageGuard.invalidate();
      usage.value = null;
      usageLoading.value = false;
      usageError.value = null;
      if (name) loadUsage(name);
    },
    { immediate: true },
  );

  // ─── Core logic ───────────────────────────────────────────
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      if (!isReadOnly.value && editorDirty.value && !saving.value) handleSave();
    }
  }

  async function loadSkill() {
    if (disposed) return;
    const token = definitionGuard.start();
    const version = draftVersion;
    assetsGuard.invalidate();
    assets.value = [];
    assetsLoading.value = false;
    closeAssetPreview();
    if (isUsageOnly.value) {
      store.selectedSkill = null;
      store.clearError();
      rawContent.value = "";
      assets.value = [];
      editorDirty.value = false;
      activeTab.value = "usage";
      return;
    }
    const directory = skillDir.value;
    if (!directory) return;
    const isCurrent = () => definitionGuard.isValid(token) && skillDir.value === directory;
    const skill = await store.getSkill(directory, isCurrent);
    if (skill && isCurrent() && draftVersion === version) {
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

  async function loadUsage(name: string) {
    await runAction({
      loading: usageLoading,
      error: usageError,
      guard: usageGuard,
      action: () => skillsUsageDetail(name, rangeBounds(usageRange.value)),
      onSuccess: (result) => {
        usage.value = result;
      },
    });
  }

  async function loadAssets() {
    const token = assetsGuard.start();
    const directory = skillDir.value;
    assetsLoading.value = true;
    const result = await store.listAssets(directory);
    if (!assetsGuard.isValid(token) || skillDir.value !== directory) return;
    assets.value = result;
    assetsLoading.value = false;
  }

  // ─── Input handlers ───────────────────────────────────────
  function setBody(body: string) {
    if (isReadOnly.value) return;
    markRawContent(replaceSkillBody(rawContent.value, body));
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
    if (isReadOnly.value || saving.value || disposed) return;
    const directory = skillDir.value;
    const version = draftVersion;
    const token = definitionGuard.current();
    saving.value = true;
    try {
      const ok = await store.updateSkillRaw(directory, rawContent.value);
      if (!ok || !definitionGuard.isValid(token) || skillDir.value !== directory) return;
      lastSaved.value = new Date();
      if (draftVersion === version) {
        editorDirty.value = false;
        await loadSkill();
      }
    } finally {
      saving.value = false;
    }
  }

  async function handleDelete() {
    if (isReadOnly.value) return;
    const directory = skillDir.value;
    const token = definitionGuard.current();
    const { confirmed } = await showConfirm({
      title: "Delete Skill",
      message: "Delete this skill? This cannot be undone.",
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed || !definitionGuard.isValid(token)) return;
    deleting.value = true;
    const ok = await store.deleteSkill(directory);
    deleting.value = false;
    if (ok && definitionGuard.isValid(token)) {
      editorDirty.value = false;
      pushRoute(router, ROUTE_NAMES.skillsManager);
    }
  }

  async function handleDiscard() {
    if (isReadOnly.value) return;
    if (!editorDirty.value) return;
    const token = definitionGuard.current();
    const { confirmed } = await showConfirm({
      title: "Discard Changes",
      message: "Discard all unsaved changes?",
      variant: "warning",
      confirmLabel: "Discard",
    });
    if (!confirmed || !definitionGuard.isValid(token)) return;
    loadSkill();
  }

  async function handleAddAsset() {
    if (isReadOnly.value) return;
    const token = definitionGuard.current();
    const path = await browseForFile({
      title: "Select asset file to add",
      filters: [{ name: "All Files", extensions: ["*"] }],
    });
    if (!path || !definitionGuard.isValid(token)) return;
    const name = path.split(/[\\/]/).pop() || path;
    const ok = await store.copyAssetFrom(skillDir.value, name, path);
    if (ok && definitionGuard.isValid(token)) await loadAssets();
  }

  async function handleNewFile(name: string) {
    if (isReadOnly.value) return;
    if (!name.trim()) return;
    const token = definitionGuard.current();
    const ok = await store.addAsset(skillDir.value, name.trim(), []);
    if (ok && definitionGuard.isValid(token)) await loadAssets();
  }

  async function handleRemoveAsset(assetPath: string) {
    if (isReadOnly.value) return;
    const token = definitionGuard.current();
    const { confirmed } = await showConfirm({
      title: "Remove Asset",
      message: `Remove asset "${assetPath}"?`,
      variant: "danger",
      confirmLabel: "Remove",
    });
    if (!confirmed || !definitionGuard.isValid(token)) return;
    const ok = await store.removeAsset(skillDir.value, assetPath);
    if (ok && definitionGuard.isValid(token)) await loadAssets();
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

  // ─── Utilities ────────────────────────────────────────────
  function formatSize(bytes: number): string {
    return formatBytes(bytes);
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
    viewingAsset,
    viewingContent,
    previewFrontmatter,
    previewBody,
    activeTab,
    usage,
    usageLoading,
    usageError,
    usageRange,
    installedSha256,
    installedBodySha256,
    leftWidth,
    minLeftWidth,
    maxLeftWidth,
    dragging,
    containerRef,
    onMouseDown,
    onResizeKeyDown,
    skillDir,
    skillName,
    isUsageOnly,
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
    setBody,
    onNameInput,
    onDescInput,
    onFrontmatterTextInput,
    onFrontmatterBooleanInput,
    onAutomaticInvocationInput,
    formatSize,
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
