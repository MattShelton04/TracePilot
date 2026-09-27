/** Render recorded terminal text as text, never as HTML or executable ANSI. */
export function normalizeTerminalText(content: string): string {
  const esc = String.fromCharCode(27);
  const bell = String.fromCharCode(7);
  const clean = content
    .replace(new RegExp(`${esc}\\][^${bell}${esc}]*(?:${bell}|${esc}\\\\)`, "g"), "")
    .replace(new RegExp(`${esc}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
    // An increment may stop part way through an escape sequence.
    .replace(new RegExp(`${esc}(?:\\[[0-?]*[ -/]*|\\][^${bell}]*)?$`), "")
    .replaceAll("\r\n", "\n");
  return clean
    .split("\n")
    .map((line) => {
      const frames = line.split("\r");
      return frames.filter((frame) => frame.length > 0).at(-1) ?? "";
    })
    .join("\n");
}

export function parseShellOutput(content: string) {
  const normalized = normalizeTerminalText(content);
  const lines = normalized.split("\n");
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  const footer = last >= 0 ? lines[last].trim() : "";
  const shell =
    /^<shellId:\s*([^\s>]+)(?:\s+(completed with exit code (-?\d+)|running))?\s*>$/i.exec(footer);
  const exited = /^Process exited with code (-?\d+)\.?$/i.exec(footer);
  const exitCode = shell?.[3] != null ? Number(shell[3]) : exited ? Number(exited[1]) : null;
  const running = shell?.[2]?.toLowerCase() === "running";
  if (shell || exited) lines.splice(last, 1);
  return {
    normalized,
    output: lines.join("\n").replace(/\n$/, ""),
    shellId: shell?.[1],
    exitCode,
    running,
  };
}

export function shellLineTone(line: string): string {
  if (
    /\b0\s+(?:errors?|failures?|failed)\b/i.test(line) &&
    !/\b[1-9]\d*\s+(?:errors?|failures?|failed)\b/i.test(line)
  )
    return "";
  if (/(?:^|\s)(?:error|failed|failure|fatal|exception)(?:\b|:)/i.test(line)) return "term-error";
  if (/\b(?:warning|deprecated)\b/i.test(line)) return "term-warning";
  if (/\b(?:pass|passed|success|succeeded|done|completed)\b/i.test(line)) return "term-success";
  return "";
}
