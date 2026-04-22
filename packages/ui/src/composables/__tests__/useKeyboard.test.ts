import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import { matchesCombo, useKeydown, useShortcut } from "../useKeyboard";

function fire(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe("matchesCombo", () => {
  it("matches plain keys case-insensitively", () => {
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "Escape" }), "Escape")).toBe(true);
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "k" }), "K")).toBe(true);
  });

  it("matches modifier combos", () => {
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }), "Ctrl+K")).toBe(
      true,
    );
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "k", metaKey: true }), "Meta+K")).toBe(
      true,
    );
  });

  it("supports key aliases (Esc, Space, Up, Return)", () => {
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "Escape" }), "Esc")).toBe(true);
    expect(matchesCombo(new KeyboardEvent("keydown", { key: " " }), "Space")).toBe(true);
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "ArrowUp" }), "Up")).toBe(true);
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "Enter" }), "Return")).toBe(true);
  });

  it("returns false when required modifier is missing", () => {
    expect(matchesCombo(new KeyboardEvent("keydown", { key: "k" }), "Ctrl+K")).toBe(false);
  });
});

describe("useKeydown", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("registers and removes a keydown listener scoped to the effect scope", () => {
    const scope = effectScope();
    const handler = vi.fn();
    scope.run(() => {
      useKeydown(handler);
    });
    fire(window, { key: "a" });
    expect(handler).toHaveBeenCalledTimes(1);

    scope.stop();
    fire(window, { key: "a" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("honours a custom target", () => {
    const scope = effectScope();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const handler = vi.fn();
    scope.run(() => {
      useKeydown(handler, { target });
    });
    fire(target, { key: "x" });
    expect(handler).toHaveBeenCalledTimes(1);
    fire(window, { key: "x" });
    expect(handler).toHaveBeenCalledTimes(1); // window listener not attached
    scope.stop();
  });
});

describe("useShortcut", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("invokes handler and prevents default on match", () => {
    const scope = effectScope();
    const handler = vi.fn();
    scope.run(() => {
      useShortcut("Ctrl+K", handler);
    });
    const e = fire(window, { key: "k", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    scope.stop();
  });

  it("skips events originating from editable elements by default", () => {
    const scope = effectScope();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const handler = vi.fn();
    scope.run(() => {
      useShortcut("Escape", handler);
    });
    input.focus();
    fire(input, { key: "Escape" });
    expect(handler).not.toHaveBeenCalled();
    scope.stop();
  });

  it("still fires on editable elements when ignoreEditable=false", () => {
    const scope = effectScope();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const handler = vi.fn();
    scope.run(() => {
      useShortcut("Escape", handler, { ignoreEditable: false });
    });
    fire(input, { key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("accepts an array of combos", () => {
    const scope = effectScope();
    const handler = vi.fn();
    scope.run(() => {
      useShortcut(["Escape", "Ctrl+Q"], handler);
    });
    fire(window, { key: "Escape" });
    fire(window, { key: "q", ctrlKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("respects the `when` gate", () => {
    const scope = effectScope();
    const handler = vi.fn();
    let enabled = false;
    scope.run(() => {
      useShortcut("Escape", handler, { when: () => enabled });
    });
    fire(window, { key: "Escape" });
    expect(handler).not.toHaveBeenCalled();
    enabled = true;
    fire(window, { key: "Escape" });
    expect(handler).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("skips handling when event.defaultPrevented is already true", () => {
    const scope = effectScope();
    const handler = vi.fn();
    scope.run(() => {
      useShortcut("Escape", handler);
    });
    const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    e.preventDefault();
    window.dispatchEvent(e);
    expect(handler).not.toHaveBeenCalled();
    scope.stop();
  });
});
