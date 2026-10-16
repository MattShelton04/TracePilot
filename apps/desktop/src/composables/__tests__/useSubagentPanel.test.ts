import { ModalDialog } from "@tracepilot/ui";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { computed, defineComponent, h, nextTick, ref } from "vue";
import type { SubagentFullData } from "../useCrossTurnSubagents";
import { useSubagentPanel } from "../useSubagentPanel";

enableAutoUnmount(afterEach);

const agents = [{ agentId: "a1" }, { agentId: "a2" }] as unknown as SubagentFullData[];

function key(target: EventTarget, name: string) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );
}

/** A component that owns a panel, rendered like a session tab's content. */
function mountPanelHost(shown = ref(true)) {
  let panel!: ReturnType<typeof useSubagentPanel>;
  const Tab = defineComponent({
    setup() {
      panel = useSubagentPanel(computed(() => agents));
      return () => h("div", { class: "tab-content" }, [h("button", "card")]);
    },
  });
  // SessionTabContent keeps every session tab mounted behind v-show.
  const Shell = defineComponent({
    setup: () => () => h("div", { style: shown.value ? {} : { display: "none" } }, [h(Tab)]),
  });
  const wrapper = mount(Shell, { attachTo: document.body });
  return { panel, wrapper, shown };
}

function mountModal(initial = true) {
  const visible = ref(initial);
  mount(
    defineComponent({
      setup: () => () =>
        h(
          ModalDialog,
          {
            visible: visible.value,
            title: "Keyboard shortcuts",
            "onUpdate:visible": (v: boolean) => {
              visible.value = v;
            },
          },
          () => h("p", "body"),
        ),
    }),
    { attachTo: document.body },
  );
  return visible;
}

describe("useSubagentPanel keyboard shortcuts", () => {
  it("Escape closes the panel and arrows move between subagents", () => {
    const { panel } = mountPanelHost();
    panel.selectSubagent("a1");

    key(document.body, "ArrowRight");
    expect(panel.selectedAgentId.value).toBe("a2");
    key(document.body, "ArrowLeft");
    expect(panel.selectedAgentId.value).toBe("a1");
    key(document.body, "Escape");
    expect(panel.isPanelOpen.value).toBe(false);
  });

  it("leaves Escape and arrows to a modal opened over the panel, then resumes", async () => {
    const { panel } = mountPanelHost();
    panel.selectSubagent("a1");
    const modalOpen = mountModal();
    await nextTick();
    await nextTick();

    const focused = document.activeElement as HTMLElement;
    expect(focused.closest('[aria-modal="true"]')).not.toBeNull();
    key(focused, "ArrowRight");
    expect(panel.selectedAgentId.value).toBe("a1");

    key(focused, "Escape");
    await nextTick();
    expect({ modalOpen: modalOpen.value, panelOpen: panel.isPanelOpen.value }).toEqual({
      modalOpen: false,
      panelOpen: true,
    });

    // With the modal gone, the next Escape belongs to the panel again.
    await nextTick();
    key(document.activeElement ?? document.body, "Escape");
    expect(panel.isPanelOpen.value).toBe(false);
  });

  it("only the shown session tab's panel reacts, whatever the mount order", async () => {
    // A hidden tab mounted earlier registered its document listener first.
    const hiddenFirst = mountPanelHost(ref(false));
    const shown = mountPanelHost();
    const hidden = mountPanelHost(ref(false));
    for (const tab of [shown, hidden, hiddenFirst]) tab.panel.selectSubagent("a1");

    key(document.body, "ArrowRight");
    expect([shown, hidden, hiddenFirst].map((tab) => tab.panel.selectedAgentId.value)).toEqual([
      "a2",
      "a1",
      "a1",
    ]);

    key(document.body, "Escape");
    expect([shown, hidden, hiddenFirst].map((tab) => tab.panel.isPanelOpen.value)).toEqual([
      false,
      true,
      true,
    ]);

    // Switching tabs hands the shortcuts to the newly shown tab.
    shown.shown.value = false;
    hidden.shown.value = true;
    await nextTick();
    key(document.body, "Escape");
    expect([hidden, hiddenFirst].map((tab) => tab.panel.isPanelOpen.value)).toEqual([false, true]);
  });
});
