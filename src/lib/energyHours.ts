import { getAllTimeEntries } from '@/db/repositories/timeRepo';

export async function getPeakFocusHours(): Promise<number[]> {
  const entries = await getAllTimeEntries();
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = entries.filter(e =>
    new Date(e.startAt).getTime() > cutoff && e.endAt
  );

  const hourTotals: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourTotals[h] = 0;

  for (const e of recent) {
    const start = new Date(e.startAt);
    const end = new Date(e.endAt!);
    const mins = (end.getTime() - start.getTime()) / 60000;
    hourTotals[start.getHours()] += mins;
  }

  return Object.entries(hourTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([h]) => parseInt(h))
    .filter(h => h >= 6 && h <= 22);
}
