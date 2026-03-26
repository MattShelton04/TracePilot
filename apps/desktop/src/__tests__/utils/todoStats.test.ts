import type { TodoDep, TodoItem } from '@tracepilot/types';
import { describe, expect, it } from 'vitest';
import { buildTodoRelations, buildTodoStatusStats } from '../../utils/todoStats';

describe('buildTodoStatusStats', () => {
  it('computes counts and progress for mixed statuses', () => {
    const todos: TodoItem[] = [
      { id: '1', title: 'Done', status: 'done' },
      { id: '2', title: 'In progress', status: 'in_progress' },
      { id: '3', title: 'Blocked', status: 'blocked' },
      { id: '4', title: 'Paused', status: 'paused' },
    ];

    const stats = buildTodoStatusStats(todos);

    expect(stats).toEqual({
      total: 4,
      done: 1,
      inProgress: 1,
      blocked: 1,
      pending: 1,
      progressPercent: 25,
    });
  });

  it('handles empty todo lists', () => {
    const stats = buildTodoStatusStats([]);

    expect(stats).toEqual({
      total: 0,
      done: 0,
      inProgress: 0,
      blocked: 0,
      pending: 0,
      progressPercent: 0,
    });
  });
});

describe('buildTodoRelations', () => {
  it('creates lookup maps for dependencies and dependents', () => {
    const todos: TodoItem[] = [
      { id: 'A', title: 'Plan', status: 'pending' },
      { id: 'B', title: 'Build', status: 'in_progress' },
      { id: 'C', title: 'Test', status: 'blocked' },
    ];
    const deps: TodoDep[] = [
      { todoId: 'B', dependsOn: 'A' },
      { todoId: 'C', dependsOn: 'A' },
      { todoId: 'C', dependsOn: 'B' },
      { todoId: 'C', dependsOn: 'missing' },
    ];

    const relations = buildTodoRelations(todos, deps);

    expect(relations.todoById.get('B')?.title).toBe('Build');
    expect(relations.dependenciesByTodoId.get('C')).toEqual(['A', 'B', 'missing']);
    expect(relations.dependentsByTodoId.get('A')).toEqual(['B', 'C']);
    expect(relations.dependentsByTodoId.get('B')).toEqual(['C']);
    expect(relations.dependentsByTodoId.get('missing')).toEqual(['C']);
    expect(relations.dependenciesByTodoId.get('none')).toBeUndefined();
  });
});
