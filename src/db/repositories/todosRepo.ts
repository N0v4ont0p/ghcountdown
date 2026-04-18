import { v4 as uuidv4 } from 'uuid';
import { Todo, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove, getAllByIndex } from '../core';

export async function getAllTodos(): Promise<Todo[]> {
  return getAll<Todo>(STORES.TODOS);
}

export async function getTodoById(id: string): Promise<Todo | undefined> {
  return getByKey<Todo>(STORES.TODOS, id);
}

export async function getTodosByStatus(status: Todo['status']): Promise<Todo[]> {
  return getAllByIndex<Todo>(STORES.TODOS, 'status', status);
}

export async function getTodosByProject(projectId: string): Promise<Todo[]> {
  return getAllByIndex<Todo>(STORES.TODOS, 'projectId', projectId);
}

export async function createTodo(
  data: Omit<Todo, 'id' | 'createdAt' | 'updatedAt' | 'locationId' | 'cognitiveLoad'> & {
    locationId?: string | null;
    cognitiveLoad?: 'high' | 'medium' | 'low' | null;
  }
): Promise<Todo> {
  const now = new Date().toISOString();
  const todo: Todo = {
    ...data,
    locationId: data.locationId ?? null,
    cognitiveLoad: data.cognitiveLoad ?? null,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.TODOS, todo);
  return todo;
}

export async function updateTodo(
  id: string,
  data: Partial<Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Todo | null> {
  const existing = await getTodoById(id);
  if (!existing) return null;

  const updated: Todo = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.TODOS, updated);
  return updated;
}

export async function deleteTodo(id: string): Promise<boolean> {
  const existing = await getTodoById(id);
  if (!existing) return false;
  await remove(STORES.TODOS, id);
  return true;
}

export async function deleteAllTodos(): Promise<void> {
  await clearStore(STORES.TODOS);
}
