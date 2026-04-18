import { v4 as uuidv4 } from 'uuid';
import { ScheduleSkeletonEntry, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove } from '../core';

export async function getAllScheduleSkeletonEntries(): Promise<ScheduleSkeletonEntry[]> {
  return getAll<ScheduleSkeletonEntry>(STORES.SCHEDULE_SKELETON);
}

export async function getScheduleSkeletonEntryById(id: string): Promise<ScheduleSkeletonEntry | undefined> {
  return getByKey<ScheduleSkeletonEntry>(STORES.SCHEDULE_SKELETON, id);
}

export async function createScheduleSkeletonEntry(
  data: Omit<ScheduleSkeletonEntry, 'id' | 'createdAt' | 'updatedAt'>
): Promise<ScheduleSkeletonEntry> {
  const now = new Date().toISOString();
  const entry: ScheduleSkeletonEntry = {
    id: uuidv4(),
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.SCHEDULE_SKELETON, entry);
  return entry;
}

export async function updateScheduleSkeletonEntry(
  id: string,
  data: Partial<Omit<ScheduleSkeletonEntry, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<ScheduleSkeletonEntry | null> {
  const existing = await getScheduleSkeletonEntryById(id);
  if (!existing) return null;

  const updated: ScheduleSkeletonEntry = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.SCHEDULE_SKELETON, updated);
  return updated;
}

export async function deleteScheduleSkeletonEntry(id: string): Promise<boolean> {
  const existing = await getScheduleSkeletonEntryById(id);
  if (!existing) return false;

  await remove(STORES.SCHEDULE_SKELETON, id);
  return true;
}

export async function deleteAllScheduleSkeletonEntries(): Promise<void> {
  await clearStore(STORES.SCHEDULE_SKELETON);
}
