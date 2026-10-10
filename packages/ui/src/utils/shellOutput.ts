import type { TurnToolCall } from "@tracepilot/types";
import { formatDuration } from "@tracepilot/types";

/** Make submitted control characters visible while retaining the exact input in Parameters. */
export function formatShellInput(input: string): string {
  return input.replace(/\r\n|[\s\S]/g, (control) => {
    if (control === "\r\n" || control === "\n") return "[Enter (newline)]";
    if (control === "\r") return "[Enter (carriage return)]";
    if (control === "\t") return "[Tab]";
    if (control === "\x7f") return "[Delete]";
    if (control.charCodeAt(0) < 32)
      return `[Ctrl+${String.fromCharCode(control.charCodeAt(0) + 64)}]`;
    return control;
  });
}

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
  const exited =
    /^Process exited with code (-?\d+)\.?$/i.exec(footer) ??
    /^<exited with exit code (-?\d+)>$/i.exec(footer);
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

export type BackgroundTone = "success" | "warning" | "danger" | "neutral";

export interface BackgroundOutcomeView {
  /** "Background · Completed · exit 0 · 2m 4s" */
  label: string;
  /** "bg done", "bg exit 1", "bg failed", "bg stopped" for the call header. */
  short: string;
  tone: BackgroundTone;
}

/** How a shell the call started in the background finished, once reported. */
export function backgroundOutcomeView(tc: TurnToolCall): BackgroundOutcomeView | null {
  const outcome = tc.backgroundOutcome;
  if (!outcome) return null;
  const status = outcome.status || "completed";
  const code = outcome.exitCode;
  const parts = ["Background", status.charAt(0).toUpperCase() + status.slice(1)];
  if (code != null) parts.push(`exit ${code}`);
  const start = tc.startedAt ? Date.parse(tc.startedAt) : Number.NaN;
  const end = outcome.completedAt ? Date.parse(outcome.completedAt) : Number.NaN;
  const duration = formatDuration(end - start);
  if (duration) parts.push(duration);
  let tone: BackgroundTone = "neutral";
  let short = `bg ${status}`;
  if (status === "completed") {
    tone = code != null && code !== 0 ? "warning" : "success";
    short = code != null && code !== 0 ? `bg exit ${code}` : "bg done";
  } else if (status === "failed") {
    tone = "danger";
    short = code != null ? `bg exit ${code}` : "bg failed";
  }
  return { label: parts.join(" · "), short, tone };
}
