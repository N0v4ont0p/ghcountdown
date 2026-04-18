import { v4 as uuidv4 } from 'uuid';
import { Goal, STORES } from '../schema';
import { getAll, getByKey, put, remove } from '../core';

export async function getAllGoals(): Promise<Goal[]> {
  return getAll<Goal>(STORES.GOALS);
}

export async function getGoalById(id: string): Promise<Goal | undefined> {
  return getByKey<Goal>(STORES.GOALS, id);
}

export async function createGoal(
  data: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Goal> {
  const now = new Date().toISOString();
  const goal: Goal = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.GOALS, goal);
  return goal;
}

export async function updateGoal(
  id: string,
  data: Partial<Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Goal | null> {
  const existing = await getGoalById(id);
  if (!existing) return null;
  const updated: Goal = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.GOALS, updated);
  return updated;
}

export async function deleteGoal(id: string): Promise<boolean> {
  const existing = await getGoalById(id);
  if (!existing) return false;
  await remove(STORES.GOALS, id);
  return true;
}
