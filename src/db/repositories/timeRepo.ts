import { v4 as uuidv4 } from 'uuid';
import { TimeEntry, STORES } from '../schema';
import { getAll, getByKey, put, remove, getAllByIndex } from '../core';

export async function getAllTimeEntries(): Promise<TimeEntry[]> {
  return getAll<TimeEntry>(STORES.TIME_ENTRIES);
}

export async function getTimeEntryById(id: string): Promise<TimeEntry | undefined> {
  return getByKey<TimeEntry>(STORES.TIME_ENTRIES, id);
}

export async function getTimeEntriesByTodo(todoId: string): Promise<TimeEntry[]> {
  return getAllByIndex<TimeEntry>(STORES.TIME_ENTRIES, 'todoId', todoId);
}

export async function getRunningTimer(): Promise<TimeEntry | null> {
  const allEntries = await getAllTimeEntries();
  const running = allEntries.find((entry) => entry.endAt === null);
  return running || null;
}

export async function getTimeEntriesInRange(
  startDate: string,
  endDate: string
): Promise<TimeEntry[]> {
  const allEntries = await getAllTimeEntries();
  return allEntries.filter(
    (entry) => entry.startAt >= startDate && entry.startAt <= endDate
  );
}

export async function createTimeEntry(
  data: Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>
): Promise<TimeEntry> {
  const now = new Date().toISOString();
  const entry: TimeEntry = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.TIME_ENTRIES, entry);
  return entry;
}

export async function updateTimeEntry(
  id: string,
  data: Partial<Omit<TimeEntry, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<TimeEntry | null> {
  const existing = await getTimeEntryById(id);
  if (!existing) return null;

  const updated: TimeEntry = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.TIME_ENTRIES, updated);
  return updated;
}

export async function deleteTimeEntry(id: string): Promise<boolean> {
  const existing = await getTimeEntryById(id);
  if (!existing) return false;
  await remove(STORES.TIME_ENTRIES, id);
  return true;
}
