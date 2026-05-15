import type { LaunchConfig, SessionTemplate } from "@tracepilot/types";
import { getTierLabel } from "@tracepilot/types";
import { useConfirmDialog } from "@tracepilot/ui";
import { type ComputedRef, computed, reactive, ref } from "vue";
import { useLauncherStore } from "@/stores/launcher";
import type { UseLauncherFormReturn } from "./useLauncherForm";

/**
 * Template selection, lifecycle, and context-menu state for the launcher.
 *
 * Mutates the form composable via `applyTemplateConfig` when a template
 * is applied, and snapshots `launchConfig` when saving a new template.
 */
export interface UseLauncherTemplatesOptions {
  form: UseLauncherFormReturn;
  launchConfig: ComputedRef<LaunchConfig>;
}

export function useLauncherTemplates(options: UseLauncherTemplatesOptions) {
  const store = useLauncherStore();
  const { confirm } = useConfirmDialog();
  const { form, launchConfig } = options;

  const selectedTemplateId = ref<string | null>(null);
  const showAdvanced = ref(false);
  const showTemplateForm = ref(false);
  const templateForm = reactive({ name: "", description: "", category: "", icon: "" });
  const contextMenuTpl = ref<{ id: string; x: number; y: number } | null>(null);
  const confirmingDeleteId = ref<string | null>(null);

  const selectedTemplateName = computed(() => {
    if (!selectedTemplateId.value) return "Custom";
    return store.templates.find((t) => t.id === selectedTemplateId.value)?.name ?? "Custom";
  });

  const defaultTemplateIds = ["default-multi-agent-review", "default-write-tests"];
  const hasDismissedDefaults = computed(() =>
    defaultTemplateIds.some((id) => !store.templates.some((t) => t.id === id)),
  );

  function tierLabel(tier: string): string {
    if (tier === "premium" || tier === "standard" || tier === "fast") {
      return getTierLabel(tier);
    }
    return tier.charAt(0).toUpperCase() + tier.slice(1);
  }

  function extractEmoji(name: string): string {
    const match = name.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
    return match ? match[0] : "📄";
  }

  function templateIcon(tpl: SessionTemplate): string {
    return tpl.icon || extractEmoji(tpl.name);
  }

  function templateDisplayName(name: string): string {
    return name.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*/u, "");
  }

  function clearTemplateSelection() {
    selectedTemplateId.value = null;
  }

  function applyTemplate(tplId: string) {
    if (selectedTemplateId.value === tplId) {
      selectedTemplateId.value = null;
      return;
    }
    const tpl = store.templates.find((t: SessionTemplate) => t.id === tplId);
    if (!tpl) return;
    selectedTemplateId.value = tplId;
    form.applyTemplateConfig(tpl);
  }

  function moveTemplate(idx: number, direction: "up" | "down") {
    const target = direction === "up" ? idx - 1 : idx + 1;
    if (target < 0 || target >= store.templates.length) return;
    const arr = [...store.templates];
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    store.templates = arr;
  }

  async function deleteTemplateInline(tplId: string) {
    if (confirmingDeleteId.value === tplId) {
      await store.deleteTemplate(tplId);
      if (selectedTemplateId.value === tplId) selectedTemplateId.value = null;
      confirmingDeleteId.value = null;
    } else {
      confirmingDeleteId.value = tplId;
    }
  }

  function cancelDeleteInline() {
    confirmingDeleteId.value = null;
  }

  function openContextMenu(e: MouseEvent, tplId: string) {
    e.preventDefault();
    contextMenuTpl.value = { id: tplId, x: e.clientX, y: e.clientY };
  }

  async function deleteContextTemplate() {
    if (!contextMenuTpl.value) return;
    await store.deleteTemplate(contextMenuTpl.value.id);
    if (selectedTemplateId.value === contextMenuTpl.value.id) {
      selectedTemplateId.value = null;
    }
    contextMenuTpl.value = null;
  }

  function closeContextMenu() {
    contextMenuTpl.value = null;
  }

  async function handleSaveTemplate() {
    if (!templateForm.name.trim()) return;
    const existing = store.templates.find(
      (t) => t.name.toLowerCase() === templateForm.name.trim().toLowerCase(),
    );
    if (existing) {
      const { confirmed } = await confirm({
        title: "Overwrite Template",
        message: `Template '${existing.name}' already exists. Do you want to overwrite it?`,
        variant: "warning",
        confirmLabel: "Overwrite",
      });
      if (!confirmed) return;
    }
    await store.saveTemplate({
      id: existing?.id ?? crypto.randomUUID(),
      name: templateForm.name,
      description: templateForm.description,
      category: templateForm.category,
      icon: templateForm.icon.trim() || undefined,
      tags: [],
      config: launchConfig.value,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      usageCount: existing?.usageCount ?? 0,
    });
    showTemplateForm.value = false;
    templateForm.name = "";
    templateForm.description = "";
    templateForm.category = "";
    templateForm.icon = "";
  }

  return {
    // state
    selectedTemplateId,
    showAdvanced,
    showTemplateForm,
    templateForm,
    contextMenuTpl,
    confirmingDeleteId,
    // derived
    selectedTemplateName,
    hasDismissedDefaults,
    // helpers
    tierLabel,
    templateIcon,
    templateDisplayName,
    // actions
    applyTemplate,
    clearTemplateSelection,
    moveTemplate,
    deleteTemplateInline,
    cancelDeleteInline,
    openContextMenu,
    deleteContextTemplate,
    closeContextMenu,
    handleSaveTemplate,
  };
}

export type UseLauncherTemplatesReturn = ReturnType<typeof useLauncherTemplates>;
