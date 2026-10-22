import type { TurnToolCall } from "@tracepilot/types";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { getRendererEntry } from "../components/renderers/registry";
import TaskListRenderer from "../components/renderers/TaskListRenderer.vue";
import { parseTaskListCall } from "../components/renderers/taskList";

const PLAN = "mcp__ccd_turn__update_plan";
const WRAP_UP = "mcp__ccd_turn__wrap_up";
const done = (toolName: string): TurnToolCall =>
  ({ toolName, isComplete: true, success: true }) as TurnToolCall;

function render(
  toolName: string,
  args: Record<string, unknown>,
  content?: string,
  tc?: TurnToolCall,
) {
  return mount(TaskListRenderer, { props: { args, content, tc: tc ?? done(toolName) } });
}

describe("TaskListRenderer", () => {
  it("registers every Claude task-list tool for its result and its pending input", () => {
    for (const tool of [PLAN, WRAP_UP, "TodoWrite", "TaskCreate", "TaskUpdate"]) {
      const entry = getRendererEntry(tool);
      expect(entry?.resultComponent, tool).toBeDefined();
      expect(entry?.argsComponent, tool).toBe(entry?.resultComponent);
      expect(entry?.hideArgsWithRichResult, tool).toBe(true);
      expect(entry?.autoExpandArgs, tool).toBe(true);
    }
  });

  it("shows update_plan items as a numbered checklist, separate from the response", () => {
    const wrapper = render(
      PLAN,
      {
        items: [
          { content: "Read the config", status: "completed" },
          { content: "Flip the flag", status: "in_progress" },
          { content: "Run the tests", status: "pending" },
        ],
      },
      "Plan updated.",
    );
    const steps = wrapper.findAll(".task-step");
    expect(steps.map((step) => step.find(".task-step-text").text())).toEqual([
      "Read the config",
      "Flip the flag",
      "Run the tests",
    ]);
    expect(steps.map((step) => step.find(".task-step-status").text())).toEqual([
      "Done",
      "In progress",
      "Pending",
    ]);
    expect(steps[1].classes()).toContain("task-step--in_progress");
    expect(wrapper.find(".task-list").text()).not.toContain("Plan updated.");
    expect(wrapper.find(".task-response pre").text()).toBe("Plan updated.");
    expect(wrapper.find(".rs--success").exists()).toBe(true);
  });

  it("states advance/done/start by step number without inventing step names", () => {
    const advance = render(PLAN, { advance: true }, "Plan updated.");
    expect(advance.find(".task-list").exists()).toBe(false);
    expect(advance.find(".task-changes").text()).toBe("Advanced to the next step");
    const numbered = render(PLAN, { done: [2], start: 3 }, "");
    expect(numbered.findAll(".task-changes li").map((li) => li.text())).toEqual([
      "Completed step 2",
      "Started step 3",
    ]);
    expect(numbered.text()).toContain("No response recorded.");
  });

  it("shows the wrap-up recap, its question and answer options", () => {
    const wrapper = render(
      WRAP_UP,
      {
        recap: "Tests pass.\nNothing is committed.",
        ask: "Commit the change?",
        actions: [{ action: "commit" }, { label: "Not yet", message: "Leave it." }, {}],
        blocked: true,
      },
      "Shown.",
    );
    expect(wrapper.find(".task-wrapup-recap").text()).toBe("Tests pass.\nNothing is committed.");
    expect(wrapper.find(".task-wrapup-ask p").text()).toBe("Commit the change?");
    expect(wrapper.findAll(".task-wrapup-options li").map((li) => li.text())).toEqual([
      "commit",
      "Not yet",
    ]);
    expect(wrapper.find(".task-wrapup-blocked").exists()).toBe(true);
    expect(wrapper.text()).toContain("Wrap-up");
  });

  it("renders a recap without a question, and says so when there is neither", () => {
    const recapOnly = render(WRAP_UP, { recap: "Done." }, "");
    expect(recapOnly.find(".task-wrapup-ask").exists()).toBe(false);
    expect(render(WRAP_UP, {}, "").text()).toContain("No recap in the call's input.");
  });

  it("uses the same checklist for TodoWrite and keeps unknown statuses as recorded", () => {
    const wrapper = render(
      "TodoWrite",
      {
        todos: [
          { content: "Write", status: "completed", activeForm: "Writing" },
          { content: "Review", status: "blocked" },
          { content: "", status: "pending" },
        ],
      },
      "Todos have been modified successfully.",
    );
    expect(wrapper.findAll(".task-step")).toHaveLength(2);
    expect(wrapper.findAll(".task-step-status").map((s) => s.text())).toEqual(["Done", "blocked"]);
  });

  it("shows a created task with its description, and task updates as plain changes", () => {
    const created = render(
      "TaskCreate",
      { subject: "Run tests", description: "After the flag flips." },
      "Task #1 created successfully: Run tests",
    );
    expect(created.find(".task-step-text").text()).toBe("Run tests");
    expect(created.find(".task-step-description").text()).toBe("After the flag flips.");
    expect(created.text()).toContain("New task");
    // A new task has no position; its id arrives only with the response.
    expect(created.find(".task-step-number").exists()).toBe(false);

    const updated = render(
      "TaskUpdate",
      {
        taskId: "2",
        status: "in_progress",
        subject: "Run all tests",
        addBlockedBy: ["1"],
        addBlocks: [3, 4],
      },
      "Updated task #2",
    );
    expect(updated.findAll(".task-changes li").map((li) => li.text())).toEqual([
      "Marked task #2 in progress",
      "Renamed task #2 to “Run all tests”",
      "Task #2 waits on #1",
      "#3 and #4 wait on task #2",
    ]);
    expect(render("TaskUpdate", { id: 5 }, "").find(".task-changes").text()).toBe(
      "Updated task #5",
    );
  });

  it("works as the pending Parameters view without a response section", () => {
    const wrapper = mount(TaskListRenderer, {
      props: {
        args: { items: [{ content: "Plan", status: "pending" }] },
        tc: { toolName: PLAN, isComplete: false } as TurnToolCall,
      },
    });
    expect(wrapper.find(".rs--pending").exists()).toBe(true);
    expect(wrapper.find(".task-step-text").text()).toBe("Plan");
    expect(wrapper.find(".task-response").exists()).toBe(false);
  });

  it("keeps an error response visible and copes with malformed input", () => {
    const failed = render(PLAN, { items: "nope" }, "Invalid input", {
      toolName: PLAN,
      isComplete: true,
      success: false,
    } as TurnToolCall);
    expect(failed.find(".rs--error").exists()).toBe(true);
    expect(failed.find(".task-response--error").text()).toBe("Invalid input");
    expect(failed.text()).toContain("No task details in the call's input.");
    expect(render(PLAN, { items: [] }, "").text()).toContain("The call lists no steps.");
    expect(parseTaskListCall("Other", { items: [] })).toEqual({
      steps: null,
      changes: [],
      wrapUp: null,
    });
  });
});
