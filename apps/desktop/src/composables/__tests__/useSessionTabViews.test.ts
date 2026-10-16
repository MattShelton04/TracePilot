import { beforeEach, describe, expect, it } from "vitest";
import { nextTick } from "vue";
import { STORAGE_KEYS } from "@/config/storageKeys";
import {
  DEFAULT_SESSION_TAB_VIEWS,
  readSessionTabViews,
  resetSessionTabViews,
  useSessionTabViews,
} from "../useSessionTabViews";

describe("session tab view choices", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSessionTabViews();
  });

  it("defaults to chat, agent tree, graph Copilot todos, listed Claude todos, by-model metrics and the context timeline", () => {
    expect(useSessionTabViews().value).toEqual({
      conversation: "chat",
      timeline: "agent-tree",
      agentTree: "paginated",
      messagesDiagram: "sequence",
      messagesPacked: true,
      todos: "graph",
      claudeTodos: "list",
      metrics: "model",
      context: "timeline",
    });
  });

  it("shares one ref and writes choices back to storage", async () => {
    const views = useSessionTabViews();
    views.value.todos = "list";
    expect(useSessionTabViews().value.todos).toBe("list");
    await nextTick();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEYS.sessionTabViews) ?? "{}");
    expect(stored.todos).toBe("list");
  });

  it("restores stored choices after a restart", () => {
    localStorage.setItem(
      STORAGE_KEYS.sessionTabViews,
      JSON.stringify({ ...DEFAULT_SESSION_TAB_VIEWS, conversation: "compact", metrics: "agent" }),
    );
    expect(useSessionTabViews().value).toMatchObject({ conversation: "compact", metrics: "agent" });
  });

  it("keeps stored choices that are still options and defaults the rest", () => {
    expect(
      readSessionTabViews(
        JSON.stringify({
          conversation: "timeline",
          timeline: "gantt",
          messagesPacked: "yes",
          todos: "list",
          extra: 1,
        }),
      ),
    ).toEqual({
      ...DEFAULT_SESSION_TAB_VIEWS,
      conversation: "timeline",
      todos: "list",
    });
    expect(readSessionTabViews("null")).toEqual(DEFAULT_SESSION_TAB_VIEWS);
  });

  it("falls back to defaults when storage holds unreadable JSON", () => {
    localStorage.setItem(STORAGE_KEYS.sessionTabViews, "{not json");
    expect(useSessionTabViews().value).toEqual(DEFAULT_SESSION_TAB_VIEWS);
  });
});
