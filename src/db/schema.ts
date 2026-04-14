export const DB_NAME = 'ghcountdown';
export const DB_VERSION = 1;

export interface Event {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: string;
  title: string;
  status: 'inbox' | 'today' | 'done';
  dueAt: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  projectId: string | null;
  eventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  todoId: string | null;
  projectId: string | null;
  startAt: string;
  endAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  importantPriorityThreshold: 1 | 2 | 3 | 4 | 5;
  timelineStartHour: number;
  timelineEndHour: number;
  reducedMotion: boolean;
}

export const STORES = {
  EVENTS: 'events',
  PROJECTS: 'projects',
  TODOS: 'todos',
  TIME_ENTRIES: 'timeEntries',
  SETTINGS: 'settings',
} as const;
