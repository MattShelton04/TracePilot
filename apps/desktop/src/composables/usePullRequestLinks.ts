/**
 * Open and copy a linked pull request's address. The main window opens it
 * through the app's external link handler; pop-out viewers have none (they
 * hold no opener permission), so opening copies the link instead.
 */
import { useClipboard, useExternalLinkHandler, useToast } from "@tracepilot/ui";

export function usePullRequestLinks() {
  const openExternal = useExternalLinkHandler();
  const { copy } = useClipboard();
  const toast = useToast();

  async function copyLink(url: string, description?: string): Promise<void> {
    if (await copy(url)) toast.success("Link copied", description ? { description } : undefined);
    else toast.error("Couldn't copy the link");
  }

  async function open(url: string): Promise<void> {
    if (openExternal) await openExternal(url);
    else await copyLink(url, "Pop-out windows can't open the browser.");
  }

  return { canOpen: openExternal !== null, open, copyLink };
}
