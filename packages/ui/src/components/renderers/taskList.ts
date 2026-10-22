/**
 * Claude task-list calls read from their arguments: the desktop app's
 * `update_plan`/`wrap_up`, legacy `TodoWrite`, and `TaskCreate`/`TaskUpdate`.
 * Only what the call itself says is shown; a step named by number
 * (`done`/`start`) stays a number, since its text lives in an earlier call.
 */

export const UPDATE_PLAN = "mcp__ccd_turn__update_plan";
export const WRAP_UP = "mcp__ccd_turn__wrap_up";
export const TASK_LIST_TOOLS = [UPDATE_PLAN, WRAP_UP, "TodoWrite", "TaskCreate", "TaskUpdate"];

/** Claude's step statuses; anything else keeps its raw text. */
export type TaskStepStatus = "pending" | "in_progress" | "completed";

export interface TaskStep {
  text: string;
  status: TaskStepStatus | null;
  /** The recorded status when it is not one of Claude's three. */
  rawStatus: string | null;
  description: string | null;
}

export interface TaskListView {
  /** Steps listed by the call, or null when it lists none. */
  steps: TaskStep[] | null;
  /** Plain sentences for changes the call names without listing steps. */
  changes: string[];
  wrapUp: { recap: string | null; ask: string | null; options: string[]; blocked: boolean } | null;
}

const KNOWN_STATUSES: readonly string[] = ["pending", "in_progress", "completed"];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function step(raw: unknown, textKey: string): TaskStep | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const label = text(record[textKey]);
  if (!label) return null;
  const status = typeof record.status === "string" ? record.status : null;
  return {
    text: label,
    status: status && KNOWN_STATUSES.includes(status) ? (status as TaskStepStatus) : null,
    rawStatus: status && !KNOWN_STATUSES.includes(status) ? status : null,
    description: text(record.description),
  };
}

function steps(value: unknown, textKey: string): TaskStep[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((item) => step(item, textKey)).filter((item): item is TaskStep => !!item);
}

/** A 1-based step number, as `update_plan` names steps. */
function stepNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function joinNumbers(numbers: Array<string | number>): string {
  if (numbers.length <= 1) return numbers.join("");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

function planChanges(args: Record<string, unknown>): string[] {
  const changes: string[] = [];
  if (args.advance === true) changes.push("Advanced to the next step");
  const done = Array.isArray(args.done)
    ? args.done.map(stepNumber).filter((n): n is number => n != null)
    : [];
  if (done.length > 0)
    changes.push(`Completed step${done.length > 1 ? "s" : ""} ${joinNumbers(done)}`);
  const start = stepNumber(args.start);
  if (start != null) changes.push(`Started step ${start}`);
  return changes;
}

/** A task id written as a string or a number. */
function taskId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

function taskIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map(taskId)
        .filter((id): id is string => !!id)
        .map((id) => `#${id}`)
    : [];
}

const STATUS_WORDS: Record<string, string> = {
  pending: "pending",
  in_progress: "in progress",
  completed: "completed",
};

function taskUpdate(args: Record<string, unknown>): TaskListView {
  // Claude Code accepts `id`/`task_id` as spellings of `taskId`.
  const id = taskId(args.taskId) ?? taskId(args.id) ?? taskId(args.task_id);
  const name = id ? `task #${id}` : "a task";
  const status = typeof args.status === "string" ? args.status : null;
  const changes: string[] = [];
  if (status === "deleted") changes.push(`Deleted ${name}`);
  else if (status) changes.push(`Marked ${name} ${STATUS_WORDS[status] ?? status}`);
  const subject = text(args.subject);
  if (subject) changes.push(`Renamed ${name} to “${subject}”`);
  if (text(args.description)) changes.push(`Updated the description of ${name}`);
  const blockedBy = taskIds(args.addBlockedBy);
  if (blockedBy.length) changes.push(`${capitalize(name)} waits on ${joinNumbers(blockedBy)}`);
  const blocks = taskIds(args.addBlocks);
  if (blocks.length)
    changes.push(`${joinNumbers(blocks)} wait${blocks.length > 1 ? "" : "s"} on ${name}`);
  if (changes.length === 0 && id) changes.push(`Updated ${name}`);
  return { steps: null, changes, wrapUp: null };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function wrapUpOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return text(record.label) ?? text(record.action);
    })
    .filter((label): label is string => !!label);
}

/** Read a task-list call's arguments. Unknown tools and shapes yield an empty view. */
export function parseTaskListCall(toolName: string, args: Record<string, unknown>): TaskListView {
  const empty: TaskListView = { steps: null, changes: [], wrapUp: null };
  switch (toolName) {
    case UPDATE_PLAN:
      return { steps: steps(args.items, "content"), changes: planChanges(args), wrapUp: null };
    case "TodoWrite":
      return { ...empty, steps: steps(args.todos, "content") };
    case "TaskCreate": {
      const created = step({ subject: args.subject, description: args.description }, "subject");
      return created ? { ...empty, steps: [{ ...created, status: "pending" }] } : empty;
    }
    case "TaskUpdate":
      return taskUpdate(args);
    case WRAP_UP:
      return {
        ...empty,
        wrapUp: {
          recap: text(args.recap),
          ask: text(args.ask),
          options: wrapUpOptions(args.actions),
          blocked: args.blocked === true,
        },
      };
    default:
      return empty;
  }
}

/** One-line row summary, e.g. "4 steps · 1 done · 1 in progress", or "". */
export function taskListSummary(toolName: string, args: Record<string, unknown>): string {
  const view = parseTaskListCall(toolName, args);
  if (view.wrapUp) {
    const first = (view.wrapUp.recap ?? view.wrapUp.ask ?? "").split(/\r?\n/)[0] ?? "";
    return first.trim();
  }
  if (toolName === "TaskCreate") return view.steps?.[0]?.text ?? "";
  const parts: string[] = [];
  if (view.steps) {
    const count = (status: TaskStepStatus) =>
      view.steps?.filter((item) => item.status === status).length ?? 0;
    parts.push(`${view.steps.length} step${view.steps.length === 1 ? "" : "s"}`);
    if (count("completed")) parts.push(`${count("completed")} done`);
    if (count("in_progress")) parts.push(`${count("in_progress")} in progress`);
  }
  parts.push(...view.changes);
  return parts.join(" · ");
}
