import { DayStatus, DayStatusKind, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove } from '../core';

/**
 * Per-day lifecycle status (active / sick / vacation / off).
 *
 *  Days without an explicit row are treated as 'active'.  We delete the row
 *  rather than store an explicit 'active' to keep the store sparse and the
 *  default behaviour cheap.
 */

export const ALL_DAY_STATUSES: DayStatusKind[] = ['active', 'sick', 'vacation', 'off'];

export interface DayStatusMeta {
  /** Short label shown in selectors and chips. */
  label: string;
  /** One-line explanation shown in the banner. */
  description: string;
  /** Tailwind utility classes for the banner. */
  banner: string;
  /** Tailwind utility classes for the trigger pill / chip. */
  pill: string;
  /** Whether normal routine + auto-fill should be suppressed for this status. */
  suppressesRoutine: boolean;
  /** Whether the scheduler should prefer low cognitive-load todos. */
  prefersLowCognitiveLoad: boolean;
}

export const STATUS_META: Record<DayStatusKind, DayStatusMeta> = {
  active: {
    label: 'Active',
    description: 'Normal routine, auto-fill, and suggestions apply.',
    banner: 'bg-muted/40 border-border text-muted-foreground',
    pill: 'bg-card border-border text-muted-foreground',
    suppressesRoutine: false,
    prefersLowCognitiveLoad: false,
  },
  sick: {
    label: 'Sick',
    description:
      'Sick day — schedule pressure reduced and low cognitive-load tasks are preferred.',
    banner:
      'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
    pill:
      'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300',
    suppressesRoutine: false,
    prefersLowCognitiveLoad: true,
  },
  vacation: {
    label: 'Vacation',
    description:
      'Vacation — your normal routine and auto-fill are paused. Manually added blocks still appear.',
    banner:
      'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300',
    pill:
      'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-300',
    suppressesRoutine: true,
    prefersLowCognitiveLoad: false,
  },
  off: {
    label: 'Off',
    description:
      'Personal day — no routine unless you add it manually.',
    banner:
      'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300',
    pill:
      'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-300',
    suppressesRoutine: true,
    prefersLowCognitiveLoad: false,
  },
};

export function suppressesRoutine(status: DayStatusKind): boolean {
  return STATUS_META[status].suppressesRoutine;
}

export function prefersLowCognitiveLoad(status: DayStatusKind): boolean {
  return STATUS_META[status].prefersLowCognitiveLoad;
}

/** Returns the row for `date`, or `null` when the day is implicitly active. */
export async function getDayStatusRow(date: string): Promise<DayStatus | null> {
  const row = await getByKey<DayStatus>(STORES.DAY_STATUSES, date);
  return row ?? null;
}

/** Convenience: returns the effective status, defaulting to 'active'. */
export async function getDayStatus(date: string): Promise<DayStatusKind> {
  const row = await getDayStatusRow(date);
  return row?.status ?? 'active';
}

export async function getAllDayStatuses(): Promise<DayStatus[]> {
  return getAll<DayStatus>(STORES.DAY_STATUSES);
}

/**
 * Set (or clear) the status for a date.
 *
 *  - Setting status to 'active' with no note removes the row entirely so the
 *    default applies, and returns `null` to signal "row deleted".
 *  - Otherwise an upsert is performed; `createdAt` is preserved on edit, and
 *    the saved row is returned.
 */
export async function setDayStatus(
  date: string,
  status: DayStatusKind,
  note: string = '',
): Promise<DayStatus | null> {
  const trimmedNote = note.trim();
  if (status === 'active' && !trimmedNote) {
    await remove(STORES.DAY_STATUSES, date);
    return null;
  }
  const existing = await getDayStatusRow(date);
  const now = new Date().toISOString();
  const row: DayStatus = {
    date,
    status,
    note: trimmedNote,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await put(STORES.DAY_STATUSES, row);
  return row;
}

export async function clearDayStatus(date: string): Promise<void> {
  return remove(STORES.DAY_STATUSES, date);
}

export async function deleteAllDayStatuses(): Promise<void> {
  return clearStore(STORES.DAY_STATUSES);
}
