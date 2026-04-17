import { getAllTodos, updateTodo } from '@/db/repositories/todosRepo';

const ESCALATED_IDS_KEY = 'ghcountdown.escalated-ids';

function getEscalatedIds(): Set<string> {
  try {
    const stored = localStorage.getItem(ESCALATED_IDS_KEY);
    return stored ? new Set<string>(JSON.parse(stored)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveEscalatedIds(ids: Set<string>): void {
  localStorage.setItem(ESCALATED_IDS_KEY, JSON.stringify([...ids]));
}

export async function escalateOverdueTodos(): Promise<number> {
  const todos = await getAllTodos();
  const now = Date.now();
  const escalatedIds = getEscalatedIds();

  let count = 0;

  for (const todo of todos) {
    if (todo.status === 'done') continue;
    if (!todo.dueAt) continue;
    const due = new Date(todo.dueAt).getTime();
    if (due < now && todo.priority < 5 && !escalatedIds.has(todo.id)) {
      await updateTodo(todo.id, { priority: 5 });
      escalatedIds.add(todo.id);
      count++;
    }
  }

  if (count > 0) {
    saveEscalatedIds(escalatedIds);
  }

  return count;
}
