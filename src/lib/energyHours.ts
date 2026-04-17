import { differenceInMinutes, parseISO } from 'date-fns';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';

/** Number of top peak hours returned by default. */
const TOP_PEAK_HOURS = 3;

/**
 * Analyses all completed TimeEntry records and returns the hours of the day
 * (0–23) where the user has historically accumulated the most focus time,
 * sorted in descending order of total focus minutes.
 *
 * Only entries with a non-null `endAt` are considered (running timers are
 * excluded).  If there are no completed entries, an empty array is returned.
 *
 * @param topN  How many peak hours to return (default: 3)
 */
export async function getPeakFocusHours(topN = TOP_PEAK_HOURS): Promise<number[]> {
  const entries = await getAllTimeEntries();

  // Aggregate total focus minutes per hour-of-day bucket
  const minutesByHour: Record<number, number> = {};
  for (let h = 0; h < 24; h++) {
    minutesByHour[h] = 0;
  }

  for (const entry of entries) {
    if (!entry.endAt) continue;

    const start = parseISO(entry.startAt);
    const end = parseISO(entry.endAt);
    const durationMinutes = differenceInMinutes(end, start);

    if (durationMinutes <= 0) continue;

    // Attribute the full session to the hour it started in.
    // This mirrors the approach used in StatisticsView.calculateHourlyData().
    const hour = start.getHours();
    minutesByHour[hour] += durationMinutes;
  }

  // Build a list of hours that have any recorded focus time, then sort by
  // descending focus minutes and return the top N hour values.
  const rankedHours = Object.entries(minutesByHour)
    .filter(([, minutes]) => minutes > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, topN)
    .map(([hour]) => parseInt(hour, 10));

  return rankedHours;
}
