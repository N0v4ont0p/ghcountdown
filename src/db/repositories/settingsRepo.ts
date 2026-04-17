import { Settings, STORES } from '../schema';
import { getByKey, put } from '../core';

const SETTINGS_KEY = 'app-settings';

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  accentColor: 'oklch(0.60 0.19 250)',
  importantPriorityThreshold: 3,
  timelineStartHour: 5,
  timelineEndHour: 24,
  reducedMotion: false,
  aiApiKey: '',
  aiModel: '',
};

export async function getSettings(): Promise<Settings> {
  const settings = await getByKey<Settings & { id: string }>(STORES.SETTINGS, SETTINGS_KEY);
  if (!settings) {
    await saveSettings(DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }
  const { id, ...rest } = settings;
  // Merge with defaults so that new fields are populated for existing records
  return { ...DEFAULT_SETTINGS, ...rest };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await put(STORES.SETTINGS, { ...settings, id: SETTINGS_KEY });
}

export async function updateSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  await saveSettings(updated);
  return updated;
}
