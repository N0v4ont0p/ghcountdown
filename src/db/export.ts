import { getAllEvents } from './repositories/eventsRepo';
import { getAllProjects } from './repositories/projectsRepo';
import { getAllTodos } from './repositories/todosRepo';
import { getAllTimeEntries } from './repositories/timeRepo';
import { getAllTimeBlocks } from './repositories/timeBlocksRepo';
import { getSettings } from './repositories/settingsRepo';
import { getAllGoals } from './repositories/goalsRepo';
import { getAllLocations } from './repositories/locationsRepo';
import { getAllScheduleSkeletonEntries } from './repositories/scheduleSkeletonRepo';
import { getAllScheduleOverrides } from './repositories/scheduleOverridesRepo';
import { Event, Project, Todo, TimeEntry, TimeBlock, Settings, Goal, Location, ScheduleSkeletonEntry, ScheduleOverride } from './schema';
import { put, getDB } from './core';
import { STORES } from './schema';

export interface ExportData {
  version: string;
  exportedAt: string;
  data: {
    events: Event[];
    projects: Project[];
    todos: Todo[];
    timeEntries: TimeEntry[];
    timeBlocks: TimeBlock[];
    settings: Settings | null;
    goals?: Goal[];
    locations?: Location[];
    scheduleSkeleton?: ScheduleSkeletonEntry[];
    scheduleOverrides?: ScheduleOverride[];
  };
}

export async function exportAllData(): Promise<ExportData> {
  const [
    events, projects, todos, timeEntries, timeBlocks, settings,
    goals, locations, scheduleSkeleton, scheduleOverrides,
  ] = await Promise.all([
    getAllEvents(),
    getAllProjects(),
    getAllTodos(),
    getAllTimeEntries(),
    getAllTimeBlocks(),
    getSettings(),
    getAllGoals(),
    getAllLocations(),
    getAllScheduleSkeletonEntries(),
    getAllScheduleOverrides(),
  ]);

  return {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    data: {
      events,
      projects,
      todos,
      timeEntries,
      timeBlocks,
      settings,
      goals,
      locations,
      scheduleSkeleton,
      scheduleOverrides,
    },
  };
}

/**
 * Validates that a parsed JSON value is a recognizable backup created by this app.
 * Distinguishes malformed JSON (caller's responsibility) from a wrong-shape object.
 */
export function validateBackupStructure(data: unknown): data is ExportData {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.version !== 'string') return false;
  if (!d.data || typeof d.data !== 'object') return false;
  const inner = d.data as Record<string, unknown>;
  // The five required array fields that every current-format backup must contain.
  return (
    Array.isArray(inner.events) &&
    Array.isArray(inner.projects) &&
    Array.isArray(inner.todos) &&
    Array.isArray(inner.timeEntries) &&
    Array.isArray(inner.timeBlocks)
  );
}

export async function importAllData(exportData: ExportData): Promise<void> {
  // Ensure the IndexedDB schema is fully initialized before any write.
  // This is a no-op when the DB is already open, but prevents failures when
  // import is triggered before the app's own initialization useEffect completes.
  await getDB();

  const {
    events, projects, todos, timeEntries, timeBlocks, settings,
    goals, locations, scheduleSkeleton, scheduleOverrides,
  } = exportData.data;

  // Use put() (upsert) so re-importing the same backup is idempotent.
  // Guard every array with ?? [] so older or partial backups don't crash on iteration.
  for (const event of events ?? []) {
    await put(STORES.EVENTS, event);
  }

  for (const project of projects ?? []) {
    await put(STORES.PROJECTS, project);
  }

  for (const todo of todos ?? []) {
    await put(STORES.TODOS, todo);
  }

  for (const entry of timeEntries ?? []) {
    await put(STORES.TIME_ENTRIES, entry);
  }

  for (const block of timeBlocks ?? []) {
    await put(STORES.TIME_BLOCKS, block);
  }

  if (settings) {
    // The settings store uses keyPath 'id'; the exported object has the id stripped
    // by getSettings(), so we always restore it to the canonical key here.
    await put(STORES.SETTINGS, { ...settings, id: 'app-settings' });
  }

  for (const goal of goals ?? []) {
    await put(STORES.GOALS, goal);
  }

  for (const location of locations ?? []) {
    await put(STORES.LOCATIONS, location);
  }

  for (const entry of scheduleSkeleton ?? []) {
    await put(STORES.SCHEDULE_SKELETON, entry);
  }

  for (const override of scheduleOverrides ?? []) {
    await put(STORES.SCHEDULE_OVERRIDES, override);
  }
}

export function downloadJSON(data: ExportData, filename: string = 'ghcountdown-backup.json') {
  const jsonString = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) {
    throw new Error('No data to export');
  }

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => 
      headers.map(header => {
        const value = row[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    )
  ];

  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportTimeEntriesCSV() {
  const entries = await getAllTimeEntries();
  
  const csvData = entries.map(entry => ({
    id: entry.id,
    startAt: entry.startAt,
    endAt: entry.endAt || '',
    duration: entry.endAt ? 
      Math.round((new Date(entry.endAt).getTime() - new Date(entry.startAt).getTime()) / 1000 / 60) : '',
    todoId: entry.todoId || '',
    projectId: entry.projectId || '',
    note: entry.note || '',
    createdAt: entry.createdAt,
  }));

  downloadCSV(csvData, `ghcountdown-time-entries-${new Date().toISOString().split('T')[0]}.csv`);
}

export async function exportEventsCSV() {
  const events = await getAllEvents();
  
  const csvData = events.map(event => ({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    allDay: event.allDay,
    priority: event.priority,
    tags: Array.isArray(event.tags) ? event.tags.join(';') : '',
    notes: event.notes || '',
    createdAt: event.createdAt,
  }));

  downloadCSV(csvData, `ghcountdown-events-${new Date().toISOString().split('T')[0]}.csv`);
}

export async function exportTodosCSV() {
  const todos = await getAllTodos();
  
  const csvData = todos.map(todo => ({
    id: todo.id,
    title: todo.title,
    status: todo.status,
    priority: todo.priority,
    dueAt: todo.dueAt || '',
    projectId: todo.projectId || '',
    eventId: todo.eventId || '',
    createdAt: todo.createdAt,
  }));

  downloadCSV(csvData, `ghcountdown-todos-${new Date().toISOString().split('T')[0]}.csv`);
}
