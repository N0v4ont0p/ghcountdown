import { v4 as uuidv4 } from 'uuid';
import { Location, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove } from '../core';

export async function getAllLocations(): Promise<Location[]> {
  return getAll<Location>(STORES.LOCATIONS);
}

export async function getLocationById(id: string): Promise<Location | undefined> {
  return getByKey<Location>(STORES.LOCATIONS, id);
}

export async function createLocation(
  data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Location> {
  const now = new Date().toISOString();
  const location: Location = {
    id: uuidv4(),
    ...data,
    createdAt: now,
    updatedAt: now,
  };

  await put(STORES.LOCATIONS, location);
  return location;
}

export async function updateLocation(
  id: string,
  data: Partial<Omit<Location, 'id' | 'createdAt' | 'updatedAt'>>
): Promise<Location | null> {
  const existing = await getLocationById(id);
  if (!existing) return null;

  const updated: Location = {
    ...existing,
    ...data,
    updatedAt: new Date().toISOString(),
  };

  await put(STORES.LOCATIONS, updated);
  return updated;
}

export async function deleteLocation(id: string): Promise<boolean> {
  const existing = await getLocationById(id);
  if (!existing) return false;

  await remove(STORES.LOCATIONS, id);
  return true;
}

export async function deleteAllLocations(): Promise<void> {
  await clearStore(STORES.LOCATIONS);
}


