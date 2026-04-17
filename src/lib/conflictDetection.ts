import { TimeBlock, Event } from '@/db/schema';

export function detectBlockConflicts(
  blocks: TimeBlock[],
  date: string
): Array<{ blockA: TimeBlock; blockB: TimeBlock }> {
  const dayBlocks = blocks.filter(b => b.date === date);
  const conflicts: Array<{ blockA: TimeBlock; blockB: TimeBlock }> = [];
  for (let i = 0; i < dayBlocks.length; i++) {
    for (let j = i + 1; j < dayBlocks.length; j++) {
      const a = dayBlocks[i], b = dayBlocks[j];
      if (a.startTime < b.endTime && b.startTime < a.endTime) {
        conflicts.push({ blockA: a, blockB: b });
      }
    }
  }
  return conflicts;
}

export function detectEventConflicts(
  events: Event[],
  blocks: TimeBlock[],
  date: string
): Array<{ event: Event; block: TimeBlock }> {
  const dayBlocks = blocks.filter(b => b.date === date);
  const dayEvents = events.filter(e => {
    const d = new Date(e.startsAt);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === date;
  });

  const conflicts: Array<{ event: Event; block: TimeBlock }> = [];
  for (const event of dayEvents) {
    const d = new Date(event.startsAt);
    const evH = d.getHours();
    const evM = d.getMinutes();
    const evStart = `${String(evH).padStart(2, '0')}:${String(evM).padStart(2, '0')}`;
    const evEndTotal = evH * 60 + evM + 60;
    const evEnd = `${String(Math.floor(evEndTotal / 60) % 24).padStart(2, '0')}:${String(evEndTotal % 60).padStart(2, '0')}`;
    for (const block of dayBlocks) {
      if (evStart < block.endTime && block.startTime < evEnd) {
        conflicts.push({ event, block });
      }
    }
  }
  return conflicts;
}
