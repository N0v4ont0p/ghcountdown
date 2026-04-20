import { getAllEvents } from './repositories/eventsRepo';
import { getAllProjects } from './repositories/projectsRepo';
import { getAllTodos } from './repositories/todosRepo';
import { getAllTimeEntries } from './repositories/timeRepo';
import { getAllTimeBlocks } from './repositories/timeBlocksRepo';
import { getSettings } from './repositories/settingsRepo';
import { Event, Project, Todo, TimeEntry, TimeBlock, Settings } from './schema';
import { add } from './core';
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
  };
}

export async function exportAllData(): Promise<ExportData> {
  const [events, projects, todos, timeEntries, timeBlocks, settings] = await Promise.all([
    getAllEvents(),
    getAllProjects(),
    getAllTodos(),
    getAllTimeEntries(),
    getAllTimeBlocks(),
    getSettings(),
  ]);

  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    data: {
      events,
      projects,
      todos,
      timeEntries,
      timeBlocks,
      settings,
    },
  };
}

export async function importAllData(exportData: ExportData): Promise<void> {
  if (!exportData.version || !exportData.data) {
    throw new Error('Invalid export data format');
  }

  const { events, projects, todos, timeEntries, timeBlocks, settings } = exportData.data;

  for (const event of events) {
    await add(STORES.EVENTS, event);
  }

  for (const project of projects) {
    await add(STORES.PROJECTS, project);
  }

  for (const todo of todos) {
    await add(STORES.TODOS, todo);
  }

  for (const entry of timeEntries) {
    await add(STORES.TIME_ENTRIES, entry);
  }

  for (const block of timeBlocks) {
    await add(STORES.TIME_BLOCKS, block);
  }

  if (settings) {
    await add(STORES.SETTINGS, settings);
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
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
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
