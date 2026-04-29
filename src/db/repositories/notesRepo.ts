import { v4 as uuidv4 } from 'uuid';
import { QuickNote, STORES } from '../schema';
import { getAll, getByKey, put, remove, clearStore } from '../core';

/**
 * Strip leading "#tag" tokens from raw input and return them separately.
 * Inline `#hashtags` anywhere in the body are also captured.  This lets users
 * type things like "buy milk #errands #urgent" or "#idea start a podcast" in
 * the launcher and have them tagged automatically.
 */
export function extractInlineTags(raw: string): { text: string; tags: string[] } {
  const tags: string[] = [];
  // Match #word characters (letters/digits/_/-), not preceded by alphanumerics
  const re = /(^|\s)#([\p{L}\p{N}_-]{1,32})\b/gu;
  const text = raw.replace(re, (_m, lead: string, tag: string) => {
    tags.push(tag.toLowerCase());
    return lead; // keep the preceding whitespace, drop the hashtag
  }).replace(/\s{2,}/g, ' ').trim();
  return { text, tags: dedupeTags(tags) };
}

export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const norm = normalizeTag(t);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').toLowerCase().slice(0, 32);
}

/** Best-effort title for a note: explicit `title` if set, otherwise first line of body. */
export function deriveNoteTitle(note: Pick<QuickNote, 'title' | 'text'>): string {
  if (note.title && note.title.trim()) return note.title.trim();
  const firstLine = (note.text ?? '').split(/\r?\n/, 1)[0]?.trim() ?? '';
  if (firstLine) return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
  return 'Untitled note';
}

export async function getAllQuickNotes(): Promise<QuickNote[]> {
  const all = await getAll<QuickNote>(STORES.QUICK_NOTES);
  // Most-recently-updated first — matches how Apple Notes / Bear / Linear order things
  return all.sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
}

export async function getQuickNoteById(id: string): Promise<QuickNote | undefined> {
  return getByKey<QuickNote>(STORES.QUICK_NOTES, id);
}

export interface CreateQuickNoteInput {
  text: string;
  title?: string;
  tags?: string[];
}

export async function createQuickNote(input: CreateQuickNoteInput | string): Promise<QuickNote> {
  // Backwards-compat: callers can pass a plain string for "just save this body"
  const data: CreateQuickNoteInput = typeof input === 'string' ? { text: input } : input;
  const now = new Date().toISOString();
  // If the caller didn't pre-extract tags, parse `#tag` syntax from the body
  let text = data.text ?? '';
  let tags = dedupeTags(data.tags ?? []);
  if (!data.tags) {
    const extracted = extractInlineTags(text);
    text = extracted.text;
    tags = dedupeTags([...tags, ...extracted.tags]);
  }
  const note: QuickNote = {
    id: uuidv4(),
    title: (data.title ?? '').trim(),
    text,
    tags,
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.QUICK_NOTES, note);
  return note;
}

export async function updateQuickNote(
  id: string,
  patch: Partial<Pick<QuickNote, 'title' | 'text' | 'tags'>>,
): Promise<QuickNote | null> {
  const existing = await getQuickNoteById(id);
  if (!existing) return null;
  const next: QuickNote = {
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(patch.text !== undefined ? { text: patch.text } : {}),
    ...(patch.tags !== undefined ? { tags: dedupeTags(patch.tags) } : {}),
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.QUICK_NOTES, next);
  return next;
}

export async function deleteQuickNote(id: string): Promise<void> {
  return remove(STORES.QUICK_NOTES, id);
}

export async function deleteAllQuickNotes(): Promise<void> {
  return clearStore(STORES.QUICK_NOTES);
}

export interface SearchOptions {
  /** Free-text query (case-insensitive substring match across title/body/tags). */
  query?: string;
  /** Restrict to notes that have ALL of these tags (lower-cased). */
  tags?: string[];
  /** Cap the number of results returned. */
  limit?: number;
}

export async function searchQuickNotes(opts: SearchOptions = {}): Promise<QuickNote[]> {
  const all = await getAllQuickNotes();
  const q = (opts.query ?? '').trim().toLowerCase();
  const requiredTags = (opts.tags ?? []).map(normalizeTag).filter(Boolean);
  let filtered = all;
  if (requiredTags.length > 0) {
    filtered = filtered.filter((n) => requiredTags.every((t) => n.tags.includes(t)));
  }
  if (q) {
    filtered = filtered.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      n.text.toLowerCase().includes(q) ||
      n.tags.some((t) => t.includes(q))
    );
  }
  if (typeof opts.limit === 'number') filtered = filtered.slice(0, opts.limit);
  return filtered;
}

/** Aggregate every distinct tag with its usage count, ordered by frequency desc. */
export async function getAllNoteTags(): Promise<Array<{ tag: string; count: number }>> {
  const notes = await getAll<QuickNote>(STORES.QUICK_NOTES);
  const counts = new Map<string, number>();
  for (const n of notes) {
    for (const t of n.tags ?? []) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

