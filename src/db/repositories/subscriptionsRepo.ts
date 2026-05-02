import { v4 as uuidv4 } from 'uuid';
import { Subscription, STORES } from '../schema';
import { clearStore, getAll, getByKey, put, remove } from '../core';

/**
 * IndexedDB persistence for the local-only subscription tracker.
 *
 * Validation lives close to the data: `normalizeSubscriptionInput` coerces
 * caller-supplied values into well-typed rows so the UI doesn't have to
 * defend itself against e.g. negative prices or stray whitespace in names.
 */

export type SubscriptionInput = Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>;

function normalizeSubscriptionInput(input: SubscriptionInput): SubscriptionInput {
  const name = (input.name ?? '').trim();
  const category = (input.category ?? '').trim() || 'Other';
  const currency = (input.currency ?? 'USD').trim().toUpperCase() || 'USD';
  const price = Number.isFinite(input.price) && input.price >= 0 ? input.price : 0;
  const rawCustomDays = input.customCycleDays as number;
  const customCycleDays =
    input.billingCycle === 'custom' && Number.isFinite(rawCustomDays) && rawCustomDays > 0
      ? Math.round(rawCustomDays)
      : null;
  const nextBillingDate =
    typeof input.nextBillingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.nextBillingDate)
      ? input.nextBillingDate
      : null;
  return {
    name,
    category,
    price,
    currency,
    billingCycle: input.billingCycle,
    customCycleDays,
    nextBillingDate,
    status: input.status,
    notes: (input.notes ?? '').trim(),
    projectId: input.projectId ?? null,
  };
}

export async function getAllSubscriptions(): Promise<Subscription[]> {
  const all = await getAll<Subscription>(STORES.SUBSCRIPTIONS);
  // Default order: active first (then trial, then cancelled), then by next
  // billing date asc, then by name.  Deterministic so the UI doesn't shuffle.
  const statusRank: Record<Subscription['status'], number> = { active: 0, trial: 1, cancelled: 2 };
  return all.sort((a, b) => {
    const sCmp = statusRank[a.status] - statusRank[b.status];
    if (sCmp !== 0) return sCmp;
    const aDate = a.nextBillingDate ?? '\uffff';
    const bDate = b.nextBillingDate ?? '\uffff';
    const dCmp = aDate.localeCompare(bDate);
    if (dCmp !== 0) return dCmp;
    return a.name.localeCompare(b.name);
  });
}

export async function getSubscriptionById(id: string): Promise<Subscription | undefined> {
  return getByKey<Subscription>(STORES.SUBSCRIPTIONS, id);
}

export async function createSubscription(input: SubscriptionInput): Promise<Subscription> {
  const normalized = normalizeSubscriptionInput(input);
  if (!normalized.name) {
    throw new Error('Subscription name is required');
  }
  const now = new Date().toISOString();
  const sub: Subscription = {
    ...normalized,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now,
  };
  await put(STORES.SUBSCRIPTIONS, sub);
  return sub;
}

export async function updateSubscription(
  id: string,
  patch: Partial<SubscriptionInput>,
): Promise<Subscription | null> {
  const existing = await getSubscriptionById(id);
  if (!existing) return null;
  // Re-normalize the merged shape so partial updates can't drop us into an
  // inconsistent state (e.g. switching to 'custom' without a cycle length).
  const merged = normalizeSubscriptionInput({
    name: patch.name ?? existing.name,
    category: patch.category ?? existing.category,
    price: patch.price ?? existing.price,
    currency: patch.currency ?? existing.currency,
    billingCycle: patch.billingCycle ?? existing.billingCycle,
    customCycleDays: patch.customCycleDays !== undefined ? patch.customCycleDays : existing.customCycleDays,
    nextBillingDate: patch.nextBillingDate !== undefined ? patch.nextBillingDate : existing.nextBillingDate,
    status: patch.status ?? existing.status,
    notes: patch.notes ?? existing.notes,
    projectId: patch.projectId !== undefined ? patch.projectId : existing.projectId,
  });
  if (!merged.name) {
    throw new Error('Subscription name is required');
  }
  const updated: Subscription = {
    ...existing,
    ...merged,
    updatedAt: new Date().toISOString(),
  };
  await put(STORES.SUBSCRIPTIONS, updated);
  return updated;
}

export async function deleteSubscription(id: string): Promise<boolean> {
  const existing = await getSubscriptionById(id);
  if (!existing) return false;
  await remove(STORES.SUBSCRIPTIONS, id);
  return true;
}

export async function deleteAllSubscriptions(): Promise<void> {
  await clearStore(STORES.SUBSCRIPTIONS);
}

/** All distinct categories currently in use, sorted alphabetically.  Used by
 *  the "custom category" combobox so previously-typed values resurface as
 *  suggestions. */
export async function getAllSubscriptionCategories(): Promise<string[]> {
  const all = await getAll<Subscription>(STORES.SUBSCRIPTIONS);
  const set = new Set<string>();
  for (const sub of all) {
    const c = (sub.category ?? '').trim();
    if (c) set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
