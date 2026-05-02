import { format } from 'date-fns';
import { Location, ScheduleSkeletonEntry } from '@/db/schema';
import { getAllScheduleSkeletonEntries } from '@/db/repositories/scheduleSkeletonRepo';
import { getScheduleOverridesByDate } from '@/db/repositories/scheduleOverridesRepo';
import { getAllLocations } from '@/db/repositories/locationsRepo';
import { getDayStatus, suppressesRoutine } from '@/db/repositories/dayStatusRepo';

export interface EffectiveScheduleEntry {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  kind: 'fixed' | 'flex';
  color: string;
  locationId: string | null;
  location: Location | null;
  notes: string;
  source: 'skeleton' | 'override-replace' | 'override-add';
}

function toDateString(date: string | Date): string {
  return typeof date === 'string' ? date : format(date, 'yyyy-MM-dd');
}

function sortByTime<T extends { startTime: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function mapWithLocations(
  entries: Array<Omit<EffectiveScheduleEntry, 'location'>>,
  locationById: Map<string, Location>
): EffectiveScheduleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    location: entry.locationId ? (locationById.get(entry.locationId) ?? null) : null,
  }));
}

function skeletonToEffective(entry: ScheduleSkeletonEntry): Omit<EffectiveScheduleEntry, 'location'> {
  return {
    id: entry.id,
    title: entry.title,
    startTime: entry.startTime,
    endTime: entry.endTime,
    kind: entry.kind,
    color: entry.color,
    locationId: entry.locationId,
    notes: entry.notes,
    source: 'skeleton',
  };
}

export async function getEffectiveScheduleForDate(date: string | Date): Promise<EffectiveScheduleEntry[]> {
  const dateStr = toDateString(date);
  const targetDate = new Date(`${dateStr}T00:00:00`);
  const dayOfWeek = targetDate.getDay();

  const [allSkeleton, overrides, locations, dayStatus] = await Promise.all([
    getAllScheduleSkeletonEntries(),
    getScheduleOverridesByDate(dateStr),
    getAllLocations(),
    getDayStatus(dateStr),
  ]);

  const locationById = new Map(locations.map((location) => [location.id, location]));

  // When the day is marked as a status that suppresses routine (vacation /
  // off), drop the recurring skeleton entries entirely.  We still apply
  // overrides — `add` overrides represent things the user explicitly added
  // for *this* date, which should survive a vacation/off marker; `skip` and
  // `replace` are no-ops on an empty effective list.
  let effective = suppressesRoutine(dayStatus)
    ? []
    : allSkeleton
        .filter((entry) => entry.active && entry.daysOfWeek.includes(dayOfWeek))
        .map((entry) => skeletonToEffective(entry));

  for (const override of overrides) {
    if (override.action === 'skip' && override.skeletonEntryId) {
      effective = effective.filter((entry) => entry.id !== override.skeletonEntryId);
      continue;
    }

    if (override.action === 'replace' && override.skeletonEntryId) {
      effective = effective.map((entry) => {
        if (entry.id !== override.skeletonEntryId) return entry;
        return {
          ...entry,
          title: override.replacementTitle ?? entry.title,
          startTime: override.replacementStartTime ?? entry.startTime,
          endTime: override.replacementEndTime ?? entry.endTime,
          locationId: override.replacementLocationId ?? entry.locationId,
          notes: override.notes || entry.notes,
          source: 'override-replace' as const,
        };
      });
      continue;
    }

    if (override.action === 'add') {
      effective.push({
        id: override.id,
        title: override.replacementTitle ?? 'Added routine',
        startTime: override.replacementStartTime ?? '09:00',
        endTime: override.replacementEndTime ?? '10:00',
        kind: 'flex',
        color: 'oklch(0.70 0.10 240)',
        locationId: override.replacementLocationId,
        notes: override.notes,
        source: 'override-add',
      });
    }
  }

  const sorted = sortByTime(effective);
  return mapWithLocations(sorted, locationById);
}

export async function getFreeSlotsForDate(date: string | Date): Promise<EffectiveScheduleEntry[]> {
  const effective = await getEffectiveScheduleForDate(date);
  return effective.filter((entry) => entry.kind === 'flex');
}

export async function getCurrentLocation(): Promise<Location | null> {
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const nowTime = format(now, 'HH:mm');
  const effective = await getEffectiveScheduleForDate(dateStr);

  const active = effective.find((entry) => nowTime >= entry.startTime && nowTime < entry.endTime);
  return active?.location ?? null;
}
