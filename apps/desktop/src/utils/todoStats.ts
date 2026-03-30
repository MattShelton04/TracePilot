import type { TodoDep, TodoItem } from "@tracepilot/types";

export interface TodoStatusStats {
  total: number;
  done: number;
  inProgress: number;
  blocked: number;
  pending: number;
  progressPercent: number;
}

export interface TodoRelations {
  todoById: Map<string, TodoItem>;
  dependenciesByTodoId: Map<string, string[]>;
  dependentsByTodoId: Map<string, string[]>;
}

export function buildTodoStatusStats(todos: TodoItem[]): TodoStatusStats {
  let done = 0;
  let inProgress = 0;
  let blocked = 0;
  let pending = 0;

  for (const todo of todos) {
    switch (todo.status) {
      case "done":
        done++;
        break;
      case "in_progress":
        inProgress++;
        break;
      case "blocked":
        blocked++;
        break;
      default:
        pending++;
        break;
    }
  }

  const total = todos.length;
  const progressPercent = total > 0 ? (done / total) * 100 : 0;

  return { total, done, inProgress, blocked, pending, progressPercent };
}

export function buildTodoRelations(todos: TodoItem[], deps: TodoDep[]): TodoRelations {
  const todoById = new Map<string, TodoItem>();
  const dependenciesByTodoId = new Map<string, string[]>();
  const dependentsByTodoId = new Map<string, string[]>();

  for (const todo of todos) {
    todoById.set(todo.id, todo);
  }

  for (const dep of deps) {
    if (!dependenciesByTodoId.has(dep.todoId)) {
      dependenciesByTodoId.set(dep.todoId, []);
    }
    dependenciesByTodoId.get(dep.todoId)?.push(dep.dependsOn);

    if (!dependentsByTodoId.has(dep.dependsOn)) {
      dependentsByTodoId.set(dep.dependsOn, []);
    }
    dependentsByTodoId.get(dep.dependsOn)?.push(dep.todoId);
  }

  return { todoById, dependenciesByTodoId, dependentsByTodoId };
}
