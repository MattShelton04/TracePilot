import { agentsGet, agentsSave, agentsSaveRaw, agentsUsageDetail } from "@tracepilot/client";
import type {
  AgentDefinitionDetail,
  AgentFields,
  AgentUsageDetail,
  SubagentOverride,
} from "@tracepilot/types";
import {
  toErrorMessage,
  useAsyncGuard,
  useConfirmDialog,
  useResizeHandle,
  useToast,
} from "@tracepilot/ui";
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
import { useUnsavedChangesGuard } from "@/composables/definitionEditor/useUnsavedChangesGuard";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import { useAgentsStore } from "@/stores/agents";
import { resolveEffectiveConfig } from "@/utils/agents/effective";
import { findOverride, isDisabled } from "@/utils/agents/entries";
import { describeOverrideChange } from "@/utils/agents/overrideSummary";
import { rangeBounds } from "@/utils/agents/range";

/** `name:<agent>` ids belong to agents seen in sessions with no definition. */
const SESSION_ONLY_PREFIX = "name:";

function cloneFields(fields: AgentFields): AgentFields {
  return { ...fields, models: [...fields.models], tools: fields.tools ? [...fields.tools] : null };
}

/**
 * State for one agent's detail page: the definition draft (when there is a
 * file), its `/subagents` override and its cross-session usage. Definition
 * and usage load independently, so an agent with no index rows still edits.
 */
export function useAgentEditor() {
  const route = useRoute();
  const router = useRouter();
  const store = useAgentsStore();
  const { confirm: showConfirm } = useConfirmDialog();
  const { success: toastSuccess } = useToast();
  const definitionGuard = useAsyncGuard();
  const usageGuard = useAsyncGuard();
  let draftVersion = 0;

  const detail = ref<AgentDefinitionDetail | null>(null);
  const usage = ref<AgentUsageDetail | null>(null);
  const fields = ref<AgentFields | null>(null);
  const body = ref("");
  const rawDraft = ref("");
  const rawMode = ref(false);
  const dirty = ref(false);
  const loading = ref(false);
  const usageLoading = ref(false);
  const saving = ref(false);
  const error = ref<string | null>(null);
  const usageError = ref<string | null>(null);
  const lastSaved = ref<Date | null>(null);
  const lastBackup = ref<string | null>(null);
  const activeTab = ref<"preview" | "usage" | "effective">("preview");

  const {
    leftWidth,
    minLeftWidth,
    maxLeftWidth,
    dragging,
    containerRef,
    onMouseDown,
    onKeyDown: onResizeKeyDown,
  } = useResizeHandle({ minPct: 25, maxPct: 75, initial: 50, minPanePx: 300, splitterPx: 5 });

  const routeId = computed(() => {
    const id = route.query.id;
    return typeof id === "string" ? id : "";
  });
  const isSessionOnly = computed(() => routeId.value.startsWith(SESSION_ONLY_PREFIX));
  const definitionPath = computed(() => (isSessionOnly.value ? "" : routeId.value));

  const agentName = computed(() => {
    if (isSessionOnly.value) return routeId.value.slice(SESSION_ONLY_PREFIX.length);
    return detail.value?.summary.name ?? usage.value?.stats.name ?? "";
  });
  /** Settings key the CLI matches on: the agent type, else the name. */
  const agentType = computed(() => usage.value?.stats.agentType || agentName.value);
  const names = computed(() =>
    [agentName.value, agentType.value, detail.value?.summary.fileStem].filter(
      (value): value is string => Boolean(value),
    ),
  );

  const settings = computed(() => store.catalog?.settings ?? null);
  const override = computed(() => findOverride(settings.value, names.value));
  const disabled = computed(() => isDisabled(settings.value, names.value));
  const effective = computed(() =>
    resolveEffectiveConfig(fields.value, override.value, settings.value, disabled.value),
  );

  const readOnlyReason = computed(() => {
    if (isSessionOnly.value) return "Seen in sessions; no definition file was found.";
    return detail.value?.summary.readOnlyReason ?? null;
  });
  const isReadOnly = computed(() => readOnlyReason.value !== null);
  const canOverride = computed(() =>
    Boolean(settings.value && agentName.value && !settings.value.shapeError),
  );

  const errorDiagnostics = computed(
    () => detail.value?.diagnostics.filter((d) => d.severity === "error") ?? [],
  );
  const canSave = computed(
    () =>
      !isReadOnly.value &&
      dirty.value &&
      !saving.value &&
      (rawMode.value || errorDiagnostics.value.length === 0),
  );

  const saveState = computed(() => {
    if (saving.value) return "Saving…";
    if (dirty.value) return "Unsaved changes";
    if (!lastSaved.value) return detail.value ? "No changes" : "";
    const seconds = Math.floor((Date.now() - lastSaved.value.getTime()) / 1000);
    if (seconds < 10) return "Just saved";
    if (seconds < 60) return `Saved ${seconds}s ago`;
    return `Saved ${Math.floor(seconds / 60)} min ago`;
  });

  useUnsavedChangesGuard({
    isDirty: () => dirty.value && !isReadOnly.value,
    title: "Unsaved Agent Changes",
    message: "Leave this agent and discard your unsaved changes?",
    isSameDocument: (to, from) => to.query.id === from.query.id,
  });

  onMounted(async () => {
    document.addEventListener("keydown", onKeydown);
    if (!store.catalog) await store.loadCatalog();
    await load();
  });

  onUnmounted(() => {
    document.removeEventListener("keydown", onKeydown);
    definitionGuard.invalidate();
    usageGuard.invalidate();
  });

  watch(routeId, () => load());
  watch(
    () => store.range,
    () => loadUsage(),
  );

  function onKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === "s") {
      event.preventDefault();
      if (canSave.value) save();
    }
  }

  /** The definition first: for a file id it supplies the name usage is keyed by. */
  async function load() {
    usageGuard.invalidate();
    usage.value = null;
    usageError.value = null;
    usageLoading.value = false;
    rawMode.value = false;
    lastSaved.value = null;
    lastBackup.value = null;
    if (await loadDefinition()) await loadUsage();
  }

  async function loadDefinition() {
    const token = definitionGuard.start();
    detail.value = null;
    fields.value = null;
    body.value = "";
    rawDraft.value = "";
    dirty.value = false;
    error.value = null;
    loading.value = false;
    if (!definitionPath.value) return true;
    loading.value = true;
    try {
      const loaded = await agentsGet(definitionPath.value);
      if (!definitionGuard.isValid(token)) return false;
      detail.value = loaded;
      fields.value = cloneFields(loaded.summary.fields);
      body.value = loaded.body;
      rawDraft.value = loaded.rawContent;
    } catch (cause) {
      if (definitionGuard.isValid(token)) error.value = toErrorMessage(cause);
    } finally {
      if (definitionGuard.isValid(token)) loading.value = false;
    }
    return definitionGuard.isValid(token);
  }

  async function loadUsage() {
    const token = usageGuard.start();
    const name = agentName.value;
    usage.value = null;
    if (!name) return;
    usageLoading.value = true;
    usageError.value = null;
    try {
      const result = await agentsUsageDetail(name, rangeBounds(store.range));
      if (usageGuard.isValid(token)) usage.value = result;
    } catch (cause) {
      if (usageGuard.isValid(token)) usageError.value = toErrorMessage(cause);
    } finally {
      if (usageGuard.isValid(token)) usageLoading.value = false;
    }
  }

  function patchFields(patch: Partial<AgentFields>) {
    if (isReadOnly.value || !fields.value) return;
    fields.value = { ...fields.value, ...patch };
    draftVersion++;
    dirty.value = true;
  }

  function setBody(next: string) {
    if (isReadOnly.value) return;
    body.value = next;
    draftVersion++;
    dirty.value = true;
  }

  function setRaw(next: string) {
    if (isReadOnly.value) return;
    rawDraft.value = next;
    draftVersion++;
    dirty.value = true;
  }

  /** Raw mode saves the whole file; form mode patches only changed keys. */
  async function save() {
    if (!canSave.value || !fields.value) return;
    saving.value = true;
    error.value = null;
    const token = definitionGuard.current();
    const version = draftVersion;
    const previousName = agentName.value;
    try {
      const result = rawMode.value
        ? await agentsSaveRaw(definitionPath.value, rawDraft.value)
        : await agentsSave(definitionPath.value, fields.value, body.value);
      if (!definitionGuard.isValid(token)) return;
      lastBackup.value = result.backupPath;
      lastSaved.value = new Date();
      // Typing while the save is in flight must keep the newer draft.
      if (draftVersion === version) {
        dirty.value = false;
        if ((await loadDefinition()) && agentName.value !== previousName) await loadUsage();
      }
      await store.loadCatalog();
    } catch (cause) {
      if (definitionGuard.isValid(token)) error.value = toErrorMessage(cause);
    } finally {
      saving.value = false;
    }
  }

  async function discard() {
    if (!dirty.value) return;
    const { confirmed } = await showConfirm({
      title: "Discard Changes",
      message: "Discard all unsaved changes to this agent?",
      variant: "warning",
      confirmLabel: "Discard",
    });
    if (confirmed) await loadDefinition();
  }

  async function remove() {
    if (isReadOnly.value || !detail.value) return;
    const { confirmed } = await showConfirm({
      title: "Delete Agent",
      message: `Delete ${detail.value.summary.name}? A backup is kept, but the file is removed.`,
      variant: "danger",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    if (await store.deleteAgent(definitionPath.value)) {
      dirty.value = false;
      pushRoute(router, ROUTE_NAMES.agentsManager);
    }
  }

  /**
   * Write the `/subagents` override (or remove it with `null`), then the
   * disabled flag. A failure leaves `store.error` set for the dialog; a
   * success is confirmed with a toast and the effective config it produced.
   */
  async function applyOverride(value: SubagentOverride | null, nextDisabled: boolean) {
    const type = agentType.value;
    const previous = override.value;
    const wasDisabled = disabled.value;
    const applied =
      (await store.setOverride(type, value)) &&
      (nextDisabled === wasDisabled || (await store.setDisabled(type, nextDisabled)));
    if (!applied) return false;
    const summary = describeOverrideChange({
      agentType: type,
      previous,
      next: value,
      wasDisabled,
      disabled: nextDisabled,
      settingsPath: settings.value?.settingsPath,
    });
    toastSuccess(summary.message, { title: summary.title });
    activeTab.value = "effective";
    return true;
  }

  function removeOverride() {
    return applyOverride(null, false);
  }

  function goBack() {
    pushRoute(router, ROUTE_NAMES.agentsManager);
  }

  return reactive({
    store,
    detail,
    usage,
    fields,
    body,
    rawDraft,
    rawMode,
    dirty,
    loading,
    usageLoading,
    saving,
    error,
    usageError,
    lastBackup,
    activeTab,
    leftWidth,
    minLeftWidth,
    maxLeftWidth,
    dragging,
    containerRef,
    onMouseDown,
    onResizeKeyDown,
    routeId,
    isSessionOnly,
    definitionPath,
    agentName,
    agentType,
    settings,
    override,
    disabled,
    effective,
    readOnlyReason,
    isReadOnly,
    canOverride,
    errorDiagnostics,
    canSave,
    saveState,
    load,
    loadUsage,
    patchFields,
    setBody,
    setRaw,
    save,
    discard,
    remove,
    applyOverride,
    removeOverride,
    goBack,
  });
}

export type AgentEditorContext = ReturnType<typeof useAgentEditor>;
export const AgentEditorKey: InjectionKey<AgentEditorContext> = Symbol("AgentEditorKey");

export function useAgentEditorContext(): AgentEditorContext {
  const ctx = inject(AgentEditorKey);
  if (!ctx) throw new Error("useAgentEditorContext must be used within an AgentEditorView");
  return ctx;
}
