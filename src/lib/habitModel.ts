import { getByKey, put } from '@/db/core';
import { STORES, TimeBlock, TimeEntry, Todo } from '@/db/schema';
import { getAllTimeEntries } from '@/db/repositories/timeRepo';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllTimeBlocks } from '@/db/repositories/timeBlocksRepo';

export const DECAY_HALF_LIFE_DAYS = 14;
const MIN_ENTRY_MINUTES = 2;
const MODEL_CACHE_MS = 15 * 60 * 1000;

export interface HabitCell {
  dayOfWeek: number;
  hour: number;
  totalWeight: number;
  topActivities: Array<{ label: string; weight: number; confidence: number }>;
}

export interface HabitModel {
  generatedAt: string;
  cells: HabitCell[];
  dailyRhythms: {
    peakFocusHours: number[];
    typicalWakeHour: number;
    typicalSleepHour: number;
    totalTrackedMinutes: number;
  };
  transitions: Record<string, Array<{ to: string; probability: number }>>;
}

interface HabitModelRecord {
  id: string;
  generatedAt: string;
  model: HabitModel;
}

let modelCache: { model: HabitModel; fetchedAt: number } | null = null;

function hoursBetween(nowMs: number, thenMs: number): number {
  return Math.max(0, (nowMs - thenMs) / (1000 * 60 * 60));
}

function addMinutesToHourMap(map: Map<number, number>, day: number, hour: number, minutes: number) {
  const key = day * 24 + hour;
  map.set(key, (map.get(key) ?? 0) + minutes);
}

function addActivityWeight(
  cellActivityWeights: Map<number, Map<string, number>>,
  day: number,
  hour: number,
  label: string,
  weight: number
) {
  const key = day * 24 + hour;
  const activityMap = cellActivityWeights.get(key) ?? new Map<string, number>();
  activityMap.set(label, (activityMap.get(label) ?? 0) + weight);
  cellActivityWeights.set(key, activityMap);
}

function toLabelFromEntry(entry: TimeEntry, todoById: Map<string, Todo>): string {
  const todoTitle = entry.todoId ? todoById.get(entry.todoId)?.title : null;
  return extractLabel(todoTitle || entry.note || 'focus');
}

function toTransitionFromBlocks(blocks: TimeBlock[]): Array<{ at: number; label: string }> {
  return blocks
    .map((block) => ({
      at: new Date(`${block.date}T${block.startTime}:00`).getTime(),
      label: extractLabel(block.title),
    }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);
}

function toTransitionFromEntries(entries: TimeEntry[], todoById: Map<string, Todo>): Array<{ at: number; label: string }> {
  return entries
    .map((entry) => ({ at: new Date(entry.startAt).getTime(), label: toLabelFromEntry(entry, todoById) }))
    .filter((item) => Number.isFinite(item.at))
    .sort((a, b) => a.at - b.at);
}

function pickTypicalHour(weightByHour: Map<number, number>, fallback: number): number {
  if (weightByHour.size === 0) return fallback;
  const sorted = Array.from(weightByHour.entries()).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] ?? fallback;
}

export function decayWeight(timestamp: string | number | Date): number {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return 0;
  const ageDays = Math.max(0, (Date.now() - then) / (1000 * 60 * 60 * 24));
  return Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);
}

export function extractLabel(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 3)
    .join(' ') || 'focus';
}

export async function computeHabitModel(): Promise<HabitModel> {
  const [entries, todos, blocks] = await Promise.all([
    getAllTimeEntries(),
    getAllTodos(),
    getAllTimeBlocks(),
  ]);

  const todoById = new Map(todos.map((todo) => [todo.id, todo]));
  const cellActivityWeights = new Map<number, Map<string, number>>();
  const cellTotalWeights = new Map<number, number>();
  const focusMinutesByHour = new Map<number, number>();
  const wakeHourWeights = new Map<number, number>();
  const sleepHourWeights = new Map<number, number>();

  let totalTrackedMinutes = 0;

  for (const entry of entries) {
    const start = new Date(entry.startAt);
    const end = entry.endAt ? new Date(entry.endAt) : new Date();
    const durationMinutes = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    if (durationMinutes < MIN_ENTRY_MINUTES) continue;

    const label = toLabelFromEntry(entry, todoById);
    const decay = decayWeight(entry.startAt);
    const weightedDuration = durationMinutes * decay;

    const day = start.getDay();
    const hour = start.getHours();
    const key = day * 24 + hour;

    addActivityWeight(cellActivityWeights, day, hour, label, weightedDuration);
    cellTotalWeights.set(key, (cellTotalWeights.get(key) ?? 0) + weightedDuration);

    if (hour >= 6 && hour <= 22) {
      addMinutesToHourMap(focusMinutesByHour, day, hour, weightedDuration);
    }

    wakeHourWeights.set(hour, (wakeHourWeights.get(hour) ?? 0) + decay);
    const endHour = end.getHours();
    sleepHourWeights.set(endHour, (sleepHourWeights.get(endHour) ?? 0) + decay);

    totalTrackedMinutes += durationMinutes;
  }

  for (const block of blocks) {
    const start = new Date(`${block.date}T${block.startTime}:00`);
    const [sH, sM] = block.startTime.split(':').map(Number);
    const [eH, eM] = block.endTime.split(':').map(Number);
    const durationMinutes = Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
    if (durationMinutes < MIN_ENTRY_MINUTES) continue;

    const label = extractLabel(block.title);
    const decay = decayWeight(start);
    const weightedDuration = durationMinutes * decay * 0.7;

    const day = start.getDay();
    const hour = start.getHours();
    const key = day * 24 + hour;

    addActivityWeight(cellActivityWeights, day, hour, label, weightedDuration);
    cellTotalWeights.set(key, (cellTotalWeights.get(key) ?? 0) + weightedDuration);

    if (hour >= 6 && hour <= 22) {
      addMinutesToHourMap(focusMinutesByHour, day, hour, weightedDuration);
    }

    wakeHourWeights.set(hour, (wakeHourWeights.get(hour) ?? 0) + decay * 0.7);
    const endHour = Number.isFinite(eH) ? eH : hour;
    sleepHourWeights.set(endHour, (sleepHourWeights.get(endHour) ?? 0) + decay * 0.7);

    totalTrackedMinutes += durationMinutes;
  }

  const cells: HabitCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = day * 24 + hour;
      const activities = cellActivityWeights.get(key) ?? new Map<string, number>();
      const totalWeight = cellTotalWeights.get(key) ?? 0;
      const topActivities = Array.from(activities.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, weight]) => ({
          label,
          weight,
          confidence: totalWeight > 0 ? weight / totalWeight : 0,
        }));

      cells.push({ dayOfWeek: day, hour, totalWeight, topActivities });
    }
  }

  const focusHourTotals = new Map<number, number>();
  for (const [cellKey, value] of focusMinutesByHour.entries()) {
    const hour = cellKey % 24;
    focusHourTotals.set(hour, (focusHourTotals.get(hour) ?? 0) + value);
  }

  const peakFocusHours = Array.from(focusHourTotals.entries())
    .filter(([hour]) => hour >= 6 && hour <= 22)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([hour]) => hour)
    .sort((a, b) => a - b);

  const sequences = [
    ...toTransitionFromEntries(entries, todoById),
    ...toTransitionFromBlocks(blocks),
  ].sort((a, b) => a.at - b.at);

  const transitionCounts = new Map<string, Map<string, number>>();
  for (let i = 0; i < sequences.length - 1; i++) {
    const current = sequences[i];
    const next = sequences[i + 1];
    const gapHours = hoursBetween(next.at, current.at);
    if (gapHours > 6) continue;
    if (current.label === next.label) continue;

    const fromMap = transitionCounts.get(current.label) ?? new Map<string, number>();
    fromMap.set(next.label, (fromMap.get(next.label) ?? 0) + 1);
    transitionCounts.set(current.label, fromMap);
  }

  const transitions: HabitModel['transitions'] = {};
  for (const [from, toMap] of transitionCounts.entries()) {
    const total = Array.from(toMap.values()).reduce((sum, value) => sum + value, 0);
    transitions[from] = Array.from(toMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([to, count]) => ({ to, probability: total > 0 ? count / total : 0 }));
  }

  const model: HabitModel = {
    generatedAt: new Date().toISOString(),
    cells,
    dailyRhythms: {
      peakFocusHours,
      typicalWakeHour: pickTypicalHour(wakeHourWeights, 7),
      typicalSleepHour: pickTypicalHour(sleepHourWeights, 23),
      totalTrackedMinutes,
    },
    transitions,
  };

  await put<HabitModelRecord>(STORES.HABIT_MODEL, {
    id: 'default',
    generatedAt: model.generatedAt,
    model,
  });

  return model;
}

export async function getHabitModel(forceRefresh = false): Promise<HabitModel> {
  const now = Date.now();
  if (!forceRefresh && modelCache && now - modelCache.fetchedAt < MODEL_CACHE_MS) {
    return modelCache.model;
  }

  if (!forceRefresh) {
    const stored = await getByKey<HabitModelRecord>(STORES.HABIT_MODEL, 'default');
    if (stored) {
      const age = now - new Date(stored.generatedAt).getTime();
      if (age < MODEL_CACHE_MS) {
        modelCache = { model: stored.model, fetchedAt: now };
        return stored.model;
      }
    }
  }

  const model = await computeHabitModel();
  modelCache = { model, fetchedAt: now };
  return model;
}

export async function predictActivity(date = new Date()): Promise<{ label: string; confidence: number } | null> {
  const model = await getHabitModel();
  const day = date.getDay();
  const hour = date.getHours();
  const cell = model.cells.find((item) => item.dayOfWeek === day && item.hour === hour);
  const prediction = cell?.topActivities[0];

  if (!prediction || prediction.confidence < 0.25) {
    return null;
  }

  return { label: prediction.label, confidence: prediction.confidence };
}

export async function detectDrift(): Promise<string[]> {
  return [];
}
