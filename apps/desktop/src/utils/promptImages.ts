/** An image attached to a prompt, by its index in the turn's attachments. */
export interface PromptImageRef {
  index: number;
  label: string;
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

function field(value: object, key: string): unknown {
  return (value as Record<string, unknown>)[key];
}

/**
 * The attachments the backend can show as pictures: a Claude Code pasted
 * image that says where its block is (`line`, `pointer`), or a Copilot CLI
 * `file` attachment of an image type.
 */
export function promptImageRefs(attachments: unknown[] | null | undefined): PromptImageRef[] {
  const refs: PromptImageRef[] = [];
  (attachments ?? []).forEach((attachment, index) => {
    if (attachment == null || typeof attachment !== "object") return;
    const type = field(attachment, "type");
    if (type === "image" && field(attachment, "pointer") != null) {
      refs.push({ index, label: `Pasted image ${refs.length + 1}` });
      return;
    }
    const path = field(attachment, "path");
    const mime = field(attachment, "mimeType");
    const isImage =
      typeof mime === "string"
        ? mime.startsWith("image/")
        : typeof path === "string" && IMAGE_FILE.test(path);
    if (type === "file" && typeof path === "string" && isImage) {
      const name = field(attachment, "displayName");
      refs.push({
        index,
        label: typeof name === "string" ? name : (path.split(/[\\/]/).pop() ?? path),
      });
    }
  });
  return refs;
}
