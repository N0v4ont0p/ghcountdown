import { getAllTodos } from '@/db/repositories/todosRepo';
import { Todo } from '@/db/schema';

export async function performDailyRollover(): Promise<Todo[]> {
  const today = new Date().toISOString().split('T')[0];
  const lastRollover = localStorage.getItem('lastRolloverDate');
  if (lastRollover === today) return [];

  const allTodos = await getAllTodos();

  const rolledOver: Todo[] = [];
  for (const todo of allTodos) {
    if (todo.status === 'today' && todo.updatedAt.split('T')[0] < today) {
      rolledOver.push(todo);
    }
  }

  localStorage.setItem('lastRolloverDate', today);
  return rolledOver;
}
