import type { Icon } from '@phosphor-icons/react';
import {
  AirplaneTilt,
  House,
  SunHorizon,
  ThermometerSimple,
} from '@phosphor-icons/react';
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
  /** Visual icon for the status (Phosphor icon). */
  icon: Icon;
  /** Tailwind utility classes for the banner container (background + border). */
  banner: string;
  /** Tailwind utility classes for the colored accent strip / left border. */
  accent: string;
  /** Tailwind utility classes for the icon halo on the banner. */
  iconBg: string;
  /** Tailwind utility classes for the title / status text color. */
  text: string;
  /** Tailwind utility classes for the segmented-control item when selected. */
  segmentSelected: string;
  /** Whether normal routine + auto-fill should be suppressed for this status. */
  suppressesRoutine: boolean;
  /** Whether the scheduler should prefer low cognitive-load todos. */
  prefersLowCognitiveLoad: boolean;
}

export const STATUS_META: Record<DayStatusKind, DayStatusMeta> = {
  active: {
    label: 'Active',
    description: 'Normal scheduling — routine, auto-fill, and suggestions all apply.',
    icon: SunHorizon,
    banner: 'bg-card border-border',
    accent: 'bg-emerald-500',
    iconBg: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    text: 'text-foreground',
    segmentSelected:
      'data-[state=on]:!bg-emerald-500 data-[state=on]:!text-white data-[state=on]:shadow-sm',
    suppressesRoutine: false,
    prefersLowCognitiveLoad: false,
  },
  sick: {
    label: 'Sick',
    description:
      'Low-energy day — routine still runs but the scheduler prefers low cognitive-load tasks.',
    icon: ThermometerSimple,
    banner: 'bg-rose-500/[0.07] border-rose-500/30',
    accent: 'bg-rose-500',
    iconBg: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    text: 'text-rose-800 dark:text-rose-200',
    segmentSelected:
      'data-[state=on]:!bg-rose-500 data-[state=on]:!text-white data-[state=on]:shadow-sm',
    suppressesRoutine: false,
    prefersLowCognitiveLoad: true,
  },
  vacation: {
    label: 'Vacation',
    description:
      'Routine paused — auto-fill and suggestions are off. Manually added blocks still appear.',
    icon: AirplaneTilt,
    banner: 'bg-sky-500/[0.07] border-sky-500/30',
    accent: 'bg-sky-500',
    iconBg: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
    text: 'text-sky-800 dark:text-sky-200',
    segmentSelected:
      'data-[state=on]:!bg-sky-500 data-[state=on]:!text-white data-[state=on]:shadow-sm',
    suppressesRoutine: true,
    prefersLowCognitiveLoad: false,
  },
  off: {
    label: 'Off',
    description:
      'Personal day — no routine unless you add it manually.',
    icon: House,
    banner: 'bg-violet-500/[0.07] border-violet-500/30',
    accent: 'bg-violet-500',
    iconBg: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    text: 'text-violet-800 dark:text-violet-200',
    segmentSelected:
      'data-[state=on]:!bg-violet-500 data-[state=on]:!text-white data-[state=on]:shadow-sm',
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
