import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { defineComponent, h } from "vue";
import { mount } from "@vue/test-utils";
import { useToast } from "../composables/useToast";

function setupToast() {
  let result!: ReturnType<typeof useToast>;
  mount(
    defineComponent({
      setup() {
        result = useToast();
        return () => h("div");
      },
    }),
  );
  return result;
}

describe("useToast", () => {
  let ctx: ReturnType<typeof setupToast>;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = setupToast();
    ctx.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic toast creation", () => {
    it("adds a toast and returns an id starting with 'toast-'", () => {
      const id = ctx.toast("hello");
      expect(id).toMatch(/^toast-/);
      expect(ctx.toasts.value).toHaveLength(1);
      expect(ctx.toasts.value[0].message).toBe("hello");
    });
  });

  describe("typed helpers", () => {
    it("success() sets type to success", () => {
      ctx.success("ok");
      expect(ctx.toasts.value[0].type).toBe("success");
    });

    it("error() sets type to error", () => {
      ctx.error("fail");
      expect(ctx.toasts.value[0].type).toBe("error");
    });

    it("warning() sets type to warning", () => {
      ctx.warning("careful");
      expect(ctx.toasts.value[0].type).toBe("warning");
    });

    it("info() sets type to info", () => {
      ctx.info("fyi");
      expect(ctx.toasts.value[0].type).toBe("info");
    });
  });

  describe("options", () => {
    it("sets title, description, action, and custom duration", () => {
      const action = { label: "Undo", onClick: vi.fn() };
      ctx.toast({
        message: "saved",
        title: "Success",
        description: "Item saved",
        duration: 5000,
        action,
      });
      const t = ctx.toasts.value[0];
      expect(t.title).toBe("Success");
      expect(t.description).toBe("Item saved");
      expect(t.duration).toBe(5000);
      expect(t.action).toEqual(action);
    });
  });

  describe("string shorthand", () => {
    it("defaults to type info and duration 3000", () => {
      ctx.toast("msg");
      const t = ctx.toasts.value[0];
      expect(t.type).toBe("info");
      expect(t.duration).toBe(3000);
    });
  });

  describe("auto-dismiss", () => {
    it("removes toast after its duration elapses", () => {
      ctx.toast({ message: "bye", duration: 3000 });
      expect(ctx.toasts.value).toHaveLength(1);
      vi.advanceTimersByTime(2999);
      expect(ctx.toasts.value).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(ctx.toasts.value).toHaveLength(0);
    });
  });

  describe("persistent toast", () => {
    it("duration 0 never auto-dismisses", () => {
      ctx.toast({ message: "sticky", duration: 0 });
      vi.advanceTimersByTime(10_000);
      expect(ctx.toasts.value).toHaveLength(1);
    });
  });

  describe("MAX_VISIBLE cap", () => {
    it("evicts oldest toast when more than 5 are added", () => {
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        ids.push(ctx.toast({ message: `toast-${i}`, duration: 0 }));
      }
      expect(ctx.toasts.value).toHaveLength(5);
      expect(ctx.toasts.value.find((t) => t.id === ids[0])).toBeUndefined();
      expect(ctx.toasts.value[0].id).toBe(ids[1]);
    });
  });

  describe("dismiss", () => {
    it("removes a specific toast by id and clears its timer", () => {
      const id = ctx.toast({ message: "temp", duration: 5000 });
      expect(ctx.toasts.value).toHaveLength(1);
      ctx.dismiss(id);
      expect(ctx.toasts.value).toHaveLength(0);
      vi.advanceTimersByTime(6000);
      expect(ctx.toasts.value).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all toasts and timers", () => {
      ctx.toast("a");
      ctx.toast("b");
      ctx.toast("c");
      expect(ctx.toasts.value).toHaveLength(3);
      ctx.clear();
      expect(ctx.toasts.value).toHaveLength(0);
      vi.advanceTimersByTime(10_000);
      expect(ctx.toasts.value).toHaveLength(0);
    });
  });

  describe("pauseTimer / resumeTimer", () => {
    it("pause stops countdown, resume continues from remaining", () => {
      const id = ctx.toast({ message: "hover", duration: 3000 });
      vi.advanceTimersByTime(1000);
      expect(ctx.toasts.value).toHaveLength(1);

      ctx.pauseTimer(id);
      vi.advanceTimersByTime(5000);
      expect(ctx.toasts.value).toHaveLength(1);

      ctx.resumeTimer(id);
      vi.advanceTimersByTime(1999);
      expect(ctx.toasts.value).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(ctx.toasts.value).toHaveLength(0);
    });
  });

  describe("singleton state", () => {
    it("two composable instances share the same toasts array", () => {
      const a = setupToast();
      const b = setupToast();
      a.toast("from a");
      expect(b.toasts.value).toHaveLength(1);
      expect(b.toasts.value[0].message).toBe("from a");
    });
  });

  describe("toast with all options", () => {
    it("propagates title, description, and action fields", () => {
      const onClick = vi.fn();
      ctx.success("done", {
        title: "Saved",
        description: "Your file was saved",
        action: { label: "View", onClick },
      });
      const t = ctx.toasts.value[0];
      expect(t.type).toBe("success");
      expect(t.message).toBe("done");
      expect(t.title).toBe("Saved");
      expect(t.description).toBe("Your file was saved");
      expect(t.action!.label).toBe("View");
      t.action!.onClick();
      expect(onClick).toHaveBeenCalledOnce();
    });
  });
});
