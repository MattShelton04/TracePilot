import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { pushRoute } from "@/router/navigation";
import SkillsManagerView from "@/views/skills/SkillsManagerView.vue";

const { getStore } = vi.hoisted(() => ({ getStore: vi.fn() }));
vi.mock("@/stores/skills", () => ({ useSkillsStore: getStore }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

async function openForm() {
  const store = reactive({
    error: null as string | null,
    loading: false,
    tokenBudget: { enabledTokens: 0, totalSkills: 0, enabledSkills: 0 },
    globalSkills: [],
    repoSkills: [],
    builtinSkills: [],
    filteredSkills: [],
    diagnostics: [],
    searchQuery: "",
    filterScope: "all",
    loadSkills: vi.fn(),
    loadEncounteredProjectSkills: vi.fn(),
    createSkill: vi.fn(),
    clearError: () => {
      store.error = null;
    },
  });
  getStore.mockReturnValue(store);
  const wrapper = mount(SkillsManagerView, { attachTo: document.body });
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((b) => b.text() === "New Skill")!
    .trigger("click");
  const dialog = wrapper.get('[role="dialog"]');
  return { store, wrapper, dialog };
}

describe("new skill feedback", () => {
  it("associates both visible labels with their fields", async () => {
    const { dialog } = await openForm();
    for (const id of ["new-skill-name", "new-skill-description"]) {
      const label = dialog.get<HTMLLabelElement>(`label[for="${id}"]`);
      expect(label.element.control).toBe(dialog.get(`#${id}`).element);
    }
  });

  it("keeps backend errors in the dialog, preserves drafts and supports corrected retry", async () => {
    const { store, wrapper, dialog } = await openForm();
    await dialog.get("input").setValue("audit-existing");
    await dialog.get("textarea").setValue("Keep this description");
    store.createSkill.mockImplementationOnce(async () => {
      store.error = "Skill 'audit-existing' already exists";
      return null;
    });
    await dialog.get("input").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(dialog.get('[role="alert"]').text()).toContain("already exists");
    expect(dialog.get<HTMLTextAreaElement>("textarea").element.value).toBe("Keep this description");
    expect(store.error).toBeNull();
    expect(pushRoute).not.toHaveBeenCalled();
    store.createSkill.mockResolvedValueOnce("audit-created-directory");
    await dialog.get("input").setValue("audit-new");
    await dialog.get("input").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(store.createSkill).toHaveBeenLastCalledWith("audit-new", "Keep this description", "");
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    expect(pushRoute).toHaveBeenCalledOnce();
  });

  it("does not duplicate an in-flight create and clears old failure on reopen", async () => {
    const { store, wrapper, dialog } = await openForm();
    let finish!: (value: null) => void;
    store.createSkill.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await dialog.get("input").setValue("audit-new");
    await dialog.get("input").trigger("keydown", { key: "Enter" });
    await dialog.get("input").trigger("keydown", { key: "Enter" });
    expect(store.createSkill).toHaveBeenCalledOnce();
    store.error = "Creation failed";
    finish(null);
    await flushPromises();
    expect(dialog.get('[role="alert"]').text()).toBe("Creation failed");
    await dialog
      .findAll("button")
      .find((b) => b.text() === "Cancel")!
      .trigger("click");
    await wrapper
      .findAll("button")
      .find((b) => b.text() === "New Skill")!
      .trigger("click");
    expect(wrapper.get('[role="dialog"]').find('[role="alert"]').exists()).toBe(false);
  });
});
