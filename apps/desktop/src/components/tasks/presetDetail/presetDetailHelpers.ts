import type { TaskPreset } from "@tracepilot/types";

export function taskTypeColorClass(taskType: string): string {
  const classes: Record<string, string> = {
    analysis: "type-color-accent",
    review: "type-color-success",
    generation: "type-color-warning",
    health: "type-color-danger",
    summary: "type-color-info",
  };
  const key = taskType.toLowerCase();
  for (const [k, v] of Object.entries(classes)) {
    if (key.includes(k)) return v;
  }
  return "type-color-accent";
}

export function infoLine(preset: TaskPreset): string {
  const sources = preset.context?.sources?.length ?? 0;
  const vars = preset.prompt?.variables?.length ?? 0;
  const parts: string[] = [];
  if (sources > 0) parts.push(`${sources} source${sources !== 1 ? "s" : ""}`);
  if (vars > 0) parts.push(`${vars} var${vars !== 1 ? "s" : ""}`);
  return parts.join(" · ") || "No sources or vars";
}
