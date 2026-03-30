/**
 * Returns true when a keyboard event originates from an editable element
 * such as form controls or contenteditable nodes.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;

  const tag = el.tagName?.toLowerCase();
  if (tag === "input") return (el as HTMLInputElement).type !== "hidden";
  if (tag === "textarea" || tag === "select") return true;

  if (el.isContentEditable) return true;
  return el.closest('[contenteditable="true"]') !== null;
}

/**
 * Determines whether a global shortcut handler should bail out because the
 * event was already handled or originated from an editable target.
 */
export function shouldIgnoreGlobalShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;
  return isEditableTarget(event.target);
}
