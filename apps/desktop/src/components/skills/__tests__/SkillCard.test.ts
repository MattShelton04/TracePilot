import type { SkillSummary } from "@tracepilot/types";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTE_NAMES } from "@/config/routes";
import { pushRoute } from "@/router/navigation";
import type { EncounteredSkillSummary } from "@/stores/skills/encountered";
import SkillCard from "../SkillCard.vue";

vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/router/navigation", () => ({ pushRoute: vi.fn() }));

enableAutoUnmount(afterEach);
beforeEach(() => vi.clearAllMocks());

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "audit-skill-with-a-long-name",
    description: "Disposable skill fixture for keyboard navigation",
    directory: "audit-only-skill",
    scope: "global",
    enabled: true,
    frontmatterTokens: 42,
    instructionTokens: 123,
    hasAssets: false,
    assetCount: 0,
    ...overrides,
  };
}

describe("SkillCard action semantics", () => {
  it.each([
    " ",
    "Enter",
  ])("allows native %j activation on the separate card button", async (key) => {
    const skill = makeSkill();
    const wrapper = mount(SkillCard, { props: { skill }, attachTo: document.body });
    expect(wrapper.element.tagName).toBe("ARTICLE");
    expect(wrapper.attributes("tabindex")).toBeUndefined();
    expect(wrapper.attributes("role")).toBeUndefined();

    const open = wrapper.get<HTMLButtonElement>(".skill-card__open");
    expect(open.element.tagName).toBe("BUTTON");
    expect(open.attributes("type")).toBe("button");
    expect(open.attributes("aria-label")).toBe(`Open skill ${skill.name}`);
    expect(open.find("button, input, [tabindex]").exists()).toBe(false);
    open.element.focus();
    for (const type of ["keydown", "keyup"]) {
      const event = new KeyboardEvent(type, { key, bubbles: true, cancelable: true });
      open.element.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(document.activeElement).toBe(open.element);
    expect(pushRoute).not.toHaveBeenCalled();

    // jsdom does not synthesize keyboard activation clicks. The native button
    // contract above allows the browser to do so; exercise that click here.
    await open.trigger("click");
    expect(pushRoute).toHaveBeenCalledExactlyOnceWith(expect.anything(), ROUTE_NAMES.skillEditor, {
      params: { name: skill.directory },
    });
  });

  it("keeps Remove and enable controls independent of card navigation", async () => {
    const skill = makeSkill();
    const wrapper = mount(SkillCard, { props: { skill }, attachTo: document.body });
    const remove = wrapper.get<HTMLButtonElement>('[title="Remove skill"]');
    expect(remove.element.closest(".skill-card__open")).toBeNull();
    remove.element.focus();
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    remove.element.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(pushRoute).not.toHaveBeenCalled();
    await remove.trigger("click");
    expect(wrapper.emitted("delete")).toEqual([[skill.directory]]);
    expect(pushRoute).not.toHaveBeenCalled();

    const enabled = wrapper.get<HTMLInputElement>('input[type="checkbox"]');
    expect(enabled.attributes("aria-label")).toBe(`Enable skill ${skill.name}`);
    expect(enabled.element.closest(".skill-card__open")).toBeNull();
    await enabled.setValue(false);
    expect(wrapper.emitted("toggleEnabled")).toEqual([[skill.directory, false]]);
    expect(pushRoute).not.toHaveBeenCalled();

    await wrapper.get('[title="Edit skill"]').trigger("click");
    expect(pushRoute).toHaveBeenCalledOnce();
  });

  it("preserves built-in read-only actions and repository-disabled enablement", async () => {
    const wrapper = mount(SkillCard, {
      props: {
        skill: makeSkill({ scope: "builtin", enabled: false, disabledReason: "repository" }),
      },
    });
    expect(wrapper.find('[title="Remove skill"]').exists()).toBe(false);
    expect(wrapper.find('[title="Edit skill"]').exists()).toBe(false);
    const enabled = wrapper.get<HTMLInputElement>('input[type="checkbox"]');
    expect(enabled.element.disabled).toBe(true);
    enabled.element.click();
    expect(wrapper.emitted("toggleEnabled")).toBeUndefined();
    await wrapper.get('[title="View skill"]').trigger("click");
    expect(pushRoute).toHaveBeenCalledOnce();
    expect(wrapper.emitted("delete")).toBeUndefined();
  });

  it("keeps encountered skills without a directory static", async () => {
    const skill: EncounteredSkillSummary = {
      ...makeSkill({ scope: "repository", directory: "" }),
      source: "session",
      sourcePath: "",
      invocationCount: 3,
    };
    const wrapper = mount(SkillCard, { props: { skill } });
    expect(wrapper.classes()).toContain("skill-card--static");
    expect(wrapper.find("button, input").exists()).toBe(false);
    expect(wrapper.text()).toContain("Seen 3 times in recent sessions");
    await wrapper.trigger("click");
    await wrapper.trigger("keydown", { key: "Enter" });
    expect(pushRoute).not.toHaveBeenCalled();

    await wrapper.setProps({ skill: { ...skill, directory: "available-audit-skill" } });
    expect(wrapper.find(".skill-card__open").exists()).toBe(true);
    expect(wrapper.find(".action-btn, input").exists()).toBe(false);
    await wrapper.get(".skill-card__open").trigger("click");
    expect(pushRoute).toHaveBeenCalledOnce();
  });
});
