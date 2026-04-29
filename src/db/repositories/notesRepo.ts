import { v4 as uuidv4 } from 'uuid';
import { QuickNote, STORES } from '../schema';
import { getAll, put, remove, clearStore } from '../core';

export async function getAllQuickNotes(): Promise<QuickNote[]> {
  const all = await getAll<QuickNote>(STORES.QUICK_NOTES);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createQuickNote(text: string): Promise<QuickNote> {
  const note: QuickNote = {
    id: uuidv4(),
    text,
    createdAt: new Date().toISOString(),
  };
  await put(STORES.QUICK_NOTES, note);
  return note;
}

export async function deleteQuickNote(id: string): Promise<void> {
  return remove(STORES.QUICK_NOTES, id);
}

export async function deleteAllQuickNotes(): Promise<void> {
  return clearStore(STORES.QUICK_NOTES);
}
