import type { ReplayStep } from "@tracepilot/types";
import { mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, onMounted, onUnmounted, ref } from "vue";
import ReplayTransportBar from "@/components/replay/ReplayTransportBar.vue";
import { useReplayController } from "@/composables/useReplayController";

describe("Replay transport and page keyboard ownership", () => {
  let wrapper: VueWrapper;
  let controller: ReturnType<typeof useReplayController>;

  beforeEach(() => {
    vi.useFakeTimers();
    wrapper = mount(
      defineComponent({
        setup() {
          controller = useReplayController(
            ref(
              Array.from({ length: 5 }, (_, index) => ({ index, durationMs: 1000 }) as ReplayStep),
            ),
          );
          onMounted(() => window.addEventListener("keydown", controller.handleKeydown));
          onUnmounted(() => window.removeEventListener("keydown", controller.handleKeydown));
          return () =>
            h("main", { tabindex: -1 }, [
              h(ReplayTransportBar, {
                currentStep: controller.currentStep.value,
                totalSteps: controller.totalSteps.value,
                isPlaying: controller.isPlaying.value,
                speed: controller.speed.value,
                elapsedFormatted: controller.formattedElapsed.value,
                totalFormatted: controller.formattedTotal.value,
                scrubberPercent: controller.scrubberPercent.value,
                onPlay: controller.play,
                onPause: controller.pause,
                onNext: controller.nextStep,
                onPrev: controller.prevStep,
                "onSet-speed": controller.setSpeed,
                "onScrub-click": controller.onScrubberClick,
                onSeek: controller.goToStep,
              }),
            ]);
        },
      }),
      { attachTo: document.body },
    );
  });

  afterEach(() => {
    wrapper.unmount();
    document.body.replaceChildren();
    vi.useRealTimers();
  });

  async function key(target: Element, value: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    target.dispatchEvent(event);
    await nextTick();
    return event;
  }

  it("moves the focused slider exactly once and seeks to real Home/End boundaries", async () => {
    const slider = wrapper.get('[role="slider"]');
    await key(slider.element, "ArrowRight");
    expect(slider.attributes("aria-valuenow")).toBe("1");
    await key(slider.element, "ArrowLeft");
    expect(slider.attributes("aria-valuenow")).toBe("0");
    await key(slider.element, "End");
    expect(slider.attributes("aria-valuenow")).toBe("4");
    await key(slider.element, "Home");
    expect(slider.attributes("aria-valuenow")).toBe("0");
    expect(Number.isFinite(controller.currentStep.value)).toBe(true);
  });

  it("leaves Space available for a speed button's native activation", async () => {
    const speed = wrapper.findAll("button").find((button) => button.text() === "2×")!;
    const event = await key(speed.element, " ");
    expect(event.defaultPrevented).toBe(false);
    expect(controller.isPlaying.value).toBe(false);
    // jsdom does not implement keyboard-generated button clicks. Check that
    // keydown permits the native action, then exercise the resulting click.
    await speed.trigger("click");
    expect(speed.attributes("aria-pressed")).toBe("true");
    expect(controller.speed.value).toBe(2);
    expect(controller.isPlaying.value).toBe(false);
    expect(wrapper.get('[aria-label="Playback speed"]').attributes("role")).toBe("group");
  });

  it("keeps unmodified page transport shortcuts working", async () => {
    await key(wrapper.element, "ArrowRight");
    expect(controller.currentStep.value).toBe(1);
    await key(wrapper.element, "End");
    expect(controller.currentStep.value).toBe(4);
    await key(wrapper.element, "Home");
    expect(controller.currentStep.value).toBe(0);
    await key(wrapper.element, "]");
    expect(controller.speed.value).toBe(2);
    await key(wrapper.element, "[");
    expect(controller.speed.value).toBe(1);
    await key(wrapper.element, " ");
    expect(controller.isPlaying.value).toBe(true);
    await key(wrapper.element, " ");
    expect(controller.isPlaying.value).toBe(false);
  });

  it.each([
    '<input value="editable">',
    "<textarea>editable</textarea>",
    "<select><option>choice</option></select>",
    '<div contenteditable="true"><span>editable</span></div>',
    '<div contenteditable="plaintext-only"><span>editable</span></div>',
    '<a href="#destination"><span>link</span></a>',
    "<button><span>button</span></button>",
    '<div role="combobox" tabindex="0"><span>choice</span></div>',
  ])("leaves keys with editable and interactive controls: %s", async (markup) => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    document.body.append(host);
    const target = host.querySelector("span") ?? host.firstElementChild!;
    expect((await key(target, "ArrowRight")).defaultPrevented).toBe(false);
    expect((await key(target, " ")).defaultPrevented).toBe(false);
    expect(controller.currentStep.value).toBe(0);
    expect(controller.isPlaying.value).toBe(false);
  });

  it("does not act on handled, modified, composing, or repeated Space events", async () => {
    const handled = new KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true });
    handled.preventDefault();
    controller.handleKeydown(handled);
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { isComposing: true },
    ]) {
      expect((await key(wrapper.element, "ArrowRight", options)).defaultPrevented).toBe(false);
    }
    await key(wrapper.element, " ", { repeat: true });
    expect(controller.currentStep.value).toBe(0);
    expect(controller.isPlaying.value).toBe(false);
  });

  it("suspends page shortcuts while a modal is open, including non-control targets", async () => {
    const modal = document.createElement("div");
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = '<p tabindex="-1">Dialog content</p>';
    document.body.append(modal);
    await key(modal.firstElementChild!, "ArrowRight");
    await key(wrapper.element, " ");
    expect(controller.currentStep.value).toBe(0);
    expect(controller.isPlaying.value).toBe(false);
    modal.remove();
    await key(wrapper.element, "ArrowRight");
    expect(controller.currentStep.value).toBe(1);
  });
});
