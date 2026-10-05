// Page chrome that works before the scenes are wired (wire.js waits for fonts): copy buttons,
// the build-from-source dialog and relative release dates. Delegated listeners only, no layout.
import { ago } from "./lib/format.js";

const html = document.documentElement;

/** "released 27 Sep 2026" -> "released 8 days ago"; the full date stays as the tooltip. */
function releaseDates() {
  for (const el of document.querySelectorAll("[data-released]")) {
    if (!el.dataset.released) continue;
    el.title = el.textContent;
    el.textContent = `released ${ago(el.dataset.released)}`;
  }
}

/** [data-copy] copies its value, or the code in its .sd-cmd block, and says so once it has. */
function copyButtons() {
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-copy]");
    if (!b) return;
    const code = b.closest(".sd-cmd")?.querySelector("code")?.textContent ?? "";
    // a Windows checkout gives the page CRLF line ends; a pasted \r can upset a shell
    const text = (b.dataset.copy || code).replace(/\r\n?/g, "\n");
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(
      () => {
        // the first label, so a second click inside the window doesn't restore "Copied"
        b.dataset.label ??= b.getAttribute("aria-label");
        b.classList.add("is-copied");
        b.setAttribute("aria-label", "Copied");
        clearTimeout(b._copied);
        b._copied = setTimeout(() => {
          b.classList.remove("is-copied");
          b.setAttribute("aria-label", b.dataset.label);
        }, 1600);
      },
      () => {},
    );
  });
}

/** Links marked [data-source-dialog] open the steps in place; without a <dialog> they navigate. */
function sourceDialog() {
  const dlg = document.getElementById("sourceDialog");
  if (!dlg?.showModal) return;
  let opener = null,
    downOnBackdrop = false;
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("[data-source-dialog]");
    if (!a || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    opener = a;
    html.classList.add("has-dialog");
    dlg.showModal();
  });
  // a click on the backdrop targets the dialog itself (the panel fills it); a text selection
  // dragged out of the panel also ends on the dialog, so the press must start there too
  dlg.addEventListener("pointerdown", (e) => {
    downOnBackdrop = e.target === dlg;
  });
  dlg.addEventListener("click", (e) => {
    if ((e.target === dlg && downOnBackdrop) || e.target.closest("[data-close]")) dlg.close();
  });
  dlg.addEventListener("close", () => {
    html.classList.remove("has-dialog");
    opener?.focus({ preventScroll: true });
    opener = null;
  });
}

export function initPage() {
  releaseDates();
  copyButtons();
  sourceDialog();
}
