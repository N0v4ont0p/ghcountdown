import { v4 as uuidv4 } from 'uuid';
import { ScheduleOverride, STORES } from '../schema';
import { clearStore, getAll, getAllByIndex, getByKey, put, remove } from '../core';

export async function getAllScheduleOverrides(): Promise<ScheduleOverride[]> {
  return getAll<ScheduleOverride>(STORES.SCHEDULE_OVERRIDES);
}

export async function getScheduleOverrideById(id: string): Promise<ScheduleOverride | undefined> {
  return getByKey<ScheduleOverride>(STORES.SCHEDULE_OVERRIDES, id);
}

export async function getScheduleOverridesByDate(date: string): Promise<ScheduleOverride[]> {
  return getAllByIndex<ScheduleOverride>(STORES.SCHEDULE_OVERRIDES, 'date', date);
}

export async function createScheduleOverride(
  data: Omit<ScheduleOverride, 'id' | 'createdAt'>
): Promise<ScheduleOverride> {
  const override: ScheduleOverride = {
    id: uuidv4(),
    ...data,
    createdAt: new Date().toISOString(),
  };

  await put(STORES.SCHEDULE_OVERRIDES, override);
  return override;
}

export async function updateScheduleOverride(
  id: string,
  data: Partial<Omit<ScheduleOverride, 'id' | 'createdAt'>>
): Promise<ScheduleOverride | null> {
  const existing = await getScheduleOverrideById(id);
  if (!existing) return null;

  const updated: ScheduleOverride = {
    ...existing,
    ...data,
  };

  await put(STORES.SCHEDULE_OVERRIDES, updated);
  return updated;
}

export async function deleteScheduleOverride(id: string): Promise<boolean> {
  const existing = await getScheduleOverrideById(id);
  if (!existing) return false;

  await remove(STORES.SCHEDULE_OVERRIDES, id);
  return true;
}

export async function deleteAllScheduleOverrides(): Promise<void> {
  await clearStore(STORES.SCHEDULE_OVERRIDES);
}
