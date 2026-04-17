import { v4 as uuidv4 } from 'uuid';
import { TimeBlock, STORES } from '../schema';
import { clearStore, getAll, add, put, remove, getAllByIndex } from '../core';

export async function getAllTimeBlocks(): Promise<TimeBlock[]> {
  return getAll<TimeBlock>(STORES.TIME_BLOCKS);
}

export async function getTimeBlocksByDate(date: string): Promise<TimeBlock[]> {
  return getAllByIndex<TimeBlock>(STORES.TIME_BLOCKS, 'date', date);
}

export async function getTimeBlocksByDateRange(startDate: string, endDate: string): Promise<TimeBlock[]> {
  const allBlocks = await getAllTimeBlocks();
  return allBlocks.filter(block => block.date >= startDate && block.date <= endDate);
}

export async function getTimeBlocksByTodo(todoId: string): Promise<TimeBlock[]> {
  return getAllByIndex<TimeBlock>(STORES.TIME_BLOCKS, 'todoId', todoId);
}

export async function createTimeBlock(
  data: Omit<TimeBlock, 'id' | 'createdAt' | 'updatedAt' | 'locationId'> & { locationId?: string | null }
): Promise<TimeBlock> {
  const now = new Date().toISOString();
  const timeBlock: TimeBlock = {
    id: uuidv4(),
    ...data,
    locationId: data.locationId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await add(STORES.TIME_BLOCKS, timeBlock);
  return timeBlock;
}

export async function updateTimeBlock(
  id: string,
  updates: Partial<Omit<TimeBlock, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const blocks = await getAllTimeBlocks();
  const block = blocks.find((b) => b.id === id);
  
  if (!block) {
    throw new Error(`TimeBlock with id ${id} not found`);
  }

  const updated: TimeBlock = {
    ...block,
    ...updates,
    locationId: updates.locationId ?? block.locationId ?? null,
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.TIME_BLOCKS, updated);
}

export async function deleteTimeBlock(id: string): Promise<void> {
  await remove(STORES.TIME_BLOCKS, id);
}

export async function deleteAllTimeBlocks(): Promise<void> {
  await clearStore(STORES.TIME_BLOCKS);
}
