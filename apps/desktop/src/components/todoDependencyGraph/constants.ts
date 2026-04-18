export const STATUS_ICON: Record<string, string> = {
  done: "✓",
  in_progress: "●",
  pending: "○",
  blocked: "⊘",
};

export const STATUSES = ["done", "in_progress", "pending", "blocked"] as const;

export const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  in_progress: "In progress",
  pending: "Pending",
  blocked: "Blocked",
};

export interface StatusColor {
  stroke: string;
  fill: string;
  text: string;
}
