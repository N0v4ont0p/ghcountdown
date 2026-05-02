export const DB_NAME = 'ghcountdown';
export const DB_VERSION = 8;

export interface QuickNote {
  id: string;
  /** Optional human-readable title; if empty, UI derives one from `text`. */
  title: string;
  /** Body of the note (plain text / markdown-ish). */
  text: string;
  /** Lower-cased, deduplicated tags for filtering & search. */
  tags: string[];
  /** Optional project this note belongs to.  `null` for standalone notes. */
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  title: string;
  why: string;
  targetDate: string | null;
  status: 'active' | 'achieved' | 'abandoned';
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: string;
  title: string;
  startsAt: string;
  allDay: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  tags: string[];
  notes: string;
  goalId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  /** Optional emoji / single-glyph icon shown next to the name. */
  icon: string | null;
  /** Free-form description for the project (markdown-ish, plain text fine). */
  description: string;
  /** Lifecycle state.  'active' is the default for new and migrated projects. */
  status: 'active' | 'paused' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface Todo {
  id: string;
  title: string;
  status: 'inbox' | 'today' | 'done' | 'someday';
  dueAt: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  cognitiveLoad: 'high' | 'medium' | 'low' | null;
  projectId: string | null;
  eventId: string | null;
  goalId: string | null;
  locationId: string | null;
  estimatedMinutes: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  todoId: string | null;
  projectId: string | null;
  timeBlockId: string | null;
  startAt: string;
  endAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeBlock {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  todoId: string | null;
  projectId: string | null;
  locationId: string | null;
  color: string;
  autoTrack: boolean;
  slotType: 'fixed' | 'flex-todo' | 'flex-project';
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSkeletonEntry {
  id: string;
  title: string;
  locationId: string | null;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  kind: 'fixed' | 'flex';
  color: string;
  notes: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleOverride {
  id: string;
  date: string;
  skeletonEntryId: string | null;
  action: 'skip' | 'replace' | 'add';
  replacementTitle: string | null;
  replacementStartTime: string | null;
  replacementEndTime: string | null;
  replacementLocationId: string | null;
  notes: string;
  createdAt: string;
}

/** Lifecycle state of a single calendar day, used by the scheduler to decide
 *  whether the user's normal routine, auto-fill, and suggestions apply.
 *
 *   - 'active'   → normal routine + auto-fill + suggestions (default)
 *   - 'sick'     → routine still shown, but auto-fill / "Schedule Day" prefer
 *                  low cognitive-load todos and reduce the daily cap
 *   - 'vacation' → routine, auto-fill and suggestions are suppressed; only
 *                  blocks the user manually adds will appear
 *   - 'off'      → like 'vacation' but framed as a personal day
 *
 *  Days without an explicit row are treated as 'active'.
 */
export type DayStatusKind = 'active' | 'sick' | 'vacation' | 'off';

export interface DayStatus {
  /** Primary key — yyyy-MM-dd local-date string. */
  date: string;
  status: DayStatusKind;
  /** Optional free-form note shown in the banner (e.g. "flu", "Spain"). */
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
  aiApiKey: string;
  aiModel: string;
  /** macOS only: show the compact floating mini-panel widget (default: false) */
  miniPanelEnabled: boolean;
}

export const STORES = {
  EVENTS: 'events',
  PROJECTS: 'projects',
  TODOS: 'todos',
  TIME_ENTRIES: 'timeEntries',
  TIME_BLOCKS: 'timeBlocks',
  SETTINGS: 'settings',
  LOCATIONS: 'locations',
  SCHEDULE_SKELETON: 'scheduleSkeleton',
  SCHEDULE_OVERRIDES: 'scheduleOverrides',
  HABIT_MODEL: 'habitModel',
  GOALS: 'goals',
  QUICK_NOTES: 'quickNotes',
  DAY_STATUSES: 'dayStatuses',
} as const;
