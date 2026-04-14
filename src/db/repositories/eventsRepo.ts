import { v4 as uuidv4 } from 'uuid';
import { Event, STORES } from '../schema';
import { getAll, getByKey, put, remove, getAllByIndex } from '../core';

export async function getAllEvents(): Promise<Event[]> {
  return getAll<Event>(STORES.EVENTS);
}

export async function getEventById(id: string): Promise<Event | undefined> {
  return getByKey<Event>(STORES.EVENTS, id);
}

export async function getEventsByPriority(minPriority: number): Promise<Event[]> {
  const allEvents = await getAllEvents();
  return allEvents.filter((event) => event.priority >= minPriority);
}

export async function getUpcomingEvents(limit?: number): Promise<Event[]> {
  const now = new Date().toISOString();
  const allEvents = await getAllEvents();
  const upcoming = allEvents
    .filter((event) => event.startsAt > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  
  return limit ? upcoming.slice(0, limit) : upcoming;
}

export async function getNextImportantEvent(minPriority: number): Promise<Event | null> {
  const now = new Date().toISOString();
  const allEvents = await getAllEvents();
  const important = allEvents
    .filter((event) => event.startsAt > now && event.priority >= minPriority)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  
  return important[0] || null;
}

export async function createEvent(
  data: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Event> {
  const now = new Date().toISOString();
  const event: Event = {
    ...data,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.EVENTS, event);
  return event;
}

export async function updateEvent(
  id: string,
  data: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Event | null> {
  const existing = await getEventById(id);
  if (!existing) return null;

  const updated: Event = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.EVENTS, updated);
  return updated;
}

export async function deleteEvent(id: string): Promise<boolean> {
  const existing = await getEventById(id);
  if (!existing) return false;
  await remove(STORES.EVENTS, id);
  return true;
}
