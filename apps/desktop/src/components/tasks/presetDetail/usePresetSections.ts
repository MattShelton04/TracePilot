import { ref } from "vue";

export type PresetSectionKey = "prompt" | "context" | "output" | "execution";

export function usePresetSections() {
  const sections = ref<Record<PresetSectionKey, boolean>>({
    prompt: true,
    context: false,
    output: false,
    execution: false,
  });

  function toggleSection(section: PresetSectionKey) {
    sections.value[section] = !sections.value[section];
  }

  return { sections, toggleSection };
}
