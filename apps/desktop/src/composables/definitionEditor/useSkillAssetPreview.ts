import type { SkillAsset } from "@tracepilot/types";
import { useAsyncGuard } from "@tracepilot/ui";
import { onScopeDispose, type Ref, ref, watch } from "vue";

export function useSkillAssetPreview(
  skillDir: Ref<string>,
  assets: Ref<SkillAsset[]>,
  readAsset: (directory: string, path: string) => Promise<string | null>,
) {
  const viewingAsset = ref<SkillAsset | null>(null);
  const viewingContent = ref<string | null>(null);
  const previewGuard = useAsyncGuard();
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    previewGuard.invalidate();
  });
  watch(skillDir, closeAssetPreview, { flush: "sync" });
  async function handleViewAsset(asset: SkillAsset) {
    if (disposed) return;
    const token = previewGuard.start();
    const directory = skillDir.value;
    viewingAsset.value = asset;
    viewingContent.value = null;
    if (!asset.isDirectory) {
      const content = await readAsset(directory, asset.path);
      if (previewGuard.isValid(token) && skillDir.value === directory) {
        viewingContent.value = content;
      }
    }
  }

  /** Open a relative path referenced in the markdown preview as an asset popup. */
  async function handlePreviewLinkClick(href: string) {
    // Normalize: strip leading ./
    const normalized = href.replace(/^\.\//, "");

    // Find matching asset in the loaded assets list
    const matchingAsset = assets.value.find((asset) => {
      const path = asset.path.replace(/\\/g, "/");
      return path === normalized || path.endsWith(`/${normalized}`) || asset.name === normalized;
    });

    if (matchingAsset) {
      await handleViewAsset(matchingAsset);
    } else {
      // Asset not in the tree — try reading it directly as a relative path
      await handleViewAsset({
        name: normalized.split("/").pop() ?? normalized,
        path: normalized,
        isDirectory: false,
        sizeBytes: 0,
      });
    }
  }

  /** Handle clicks in the preview markdown area for relative links (asset references). */
  function handlePreviewClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href");
    if (!href) return;

    // External/anchor links — handled by MarkdownContent's @open-external emit
    if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) return;

    // Relative links — open as asset preview
    event.preventDefault();
    event.stopPropagation();
    handlePreviewLinkClick(href);
  }

  function closeAssetPreview() {
    previewGuard.invalidate();
    viewingAsset.value = null;
    viewingContent.value = null;
  }

  return { viewingAsset, viewingContent, handleViewAsset, handlePreviewClick, closeAssetPreview };
}
