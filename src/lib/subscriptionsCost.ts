import { Subscription, SubscriptionBillingCycle } from '@/db/schema';

/** Average days per month/year used for billing-cycle normalization.  We use
 *  the Gregorian-mean year (365.25 days) and divide by 12 — this matches what
 *  most personal-finance apps do for "average monthly cost" so users see
 *  numbers consistent with Mint / YNAB / Notion templates. */
export const DAYS_PER_YEAR = 365.25;
export const DAYS_PER_MONTH = DAYS_PER_YEAR / 12;

/** Returns the cycle length in days, or `null` when the cycle is custom and
 *  no `customCycleDays` is set (caller should treat as "unknown" cost). */
export function cycleLengthDays(
  cycle: SubscriptionBillingCycle,
  customCycleDays: number | null,
): number | null {
  switch (cycle) {
    case 'weekly':  return 7;
    case 'monthly': return DAYS_PER_MONTH;
    case 'yearly':  return DAYS_PER_YEAR;
    case 'custom':
      return customCycleDays && customCycleDays > 0 ? customCycleDays : null;
    default:
      return null;
  }
}

/**
 * Average monthly cost of a single subscription in its own currency.
 *  - Cancelled rows count as 0 (the user is no longer being charged).
 *  - Trial rows count at full price (the user *will* be charged once the
 *    trial ends, and the summary should help them spot upcoming bills).
 *  - Custom cycles without `customCycleDays` are treated as 0 (incomplete row).
 */
export function monthlyCostOf(sub: Subscription): number {
  if (sub.status === 'cancelled') return 0;
  if (!Number.isFinite(sub.price) || sub.price <= 0) return 0;
  const days = cycleLengthDays(sub.billingCycle, sub.customCycleDays);
  if (!days) return 0;
  return sub.price * (DAYS_PER_MONTH / days);
}

export function yearlyCostOf(sub: Subscription): number {
  return monthlyCostOf(sub) * 12;
}

export interface CurrencyTotal {
  currency: string;
  monthly: number;
  yearly: number;
  count: number;
}

/** Group subscriptions by currency and sum their normalized monthly + yearly
 *  cost.  We deliberately do NOT FX-convert — the user's locale and
 *  preferences vary and this app is local-only.  Each currency gets its own
 *  summary row so totals are always exact. */
export function totalsByCurrency(subs: Subscription[]): CurrencyTotal[] {
  const map = new Map<string, CurrencyTotal>();
  for (const sub of subs) {
    if (sub.status === 'cancelled') continue;
    const monthly = monthlyCostOf(sub);
    if (monthly <= 0) continue;
    const ccy = (sub.currency || 'USD').toUpperCase();
    const existing = map.get(ccy);
    if (existing) {
      existing.monthly += monthly;
      existing.yearly += monthly * 12;
      existing.count += 1;
    } else {
      map.set(ccy, { currency: ccy, monthly, yearly: monthly * 12, count: 1 });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.monthly - a.monthly || a.currency.localeCompare(b.currency));
}

export interface CategoryBreakdownRow {
  category: string;
  /** Total normalized monthly cost for this category, summed *within a single currency*. */
  monthly: number;
  currency: string;
  count: number;
  /** Share of the per-currency total, in [0, 1]. */
  share: number;
}

/** Per-category breakdown, scoped to a single currency.  Categories with zero
 *  cost (e.g. only cancelled rows) are dropped. */
export function categoryBreakdown(subs: Subscription[], currency: string): CategoryBreakdownRow[] {
  const ccy = currency.toUpperCase();
  const filtered = subs.filter((s) => (s.currency || 'USD').toUpperCase() === ccy && s.status !== 'cancelled');
  const totals = new Map<string, { monthly: number; count: number }>();
  for (const sub of filtered) {
    const monthly = monthlyCostOf(sub);
    if (monthly <= 0) continue;
    const cat = (sub.category || 'Other').trim() || 'Other';
    const cur = totals.get(cat) ?? { monthly: 0, count: 0 };
    cur.monthly += monthly;
    cur.count += 1;
    totals.set(cat, cur);
  }
  const totalMonthly = Array.from(totals.values()).reduce((s, r) => s + r.monthly, 0);
  return Array.from(totals.entries())
    .map(([category, row]) => ({
      category,
      monthly: row.monthly,
      currency: ccy,
      count: row.count,
      share: totalMonthly > 0 ? row.monthly / totalMonthly : 0,
    }))
    .sort((a, b) => b.monthly - a.monthly || a.category.localeCompare(b.category));
}

/**
 * Format a number as currency using `Intl.NumberFormat`, with a graceful
 * fallback when the currency code is invalid (e.g. user typed "FOO").
 */
export function formatCurrency(amount: number, currency: string): string {
  const ccy = (currency || 'USD').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: ccy,
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    // Invalid currency code — fall back to a plain decimal with the code suffix.
    return `${amount.toFixed(2)} ${ccy}`;
  }
}

/** Number of whole days from `today` to `date` (positive = future, negative = past).
 *  Both args are interpreted in the user's local timezone using midnight as
 *  the boundary, which matches how a user thinks about "this renews tomorrow". */
export function daysUntil(date: string, today: Date = new Date()): number {
  const target = new Date(`${date}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const ms = target.getTime() - todayMidnight.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Subscriptions whose next billing date is within `withinDays` (default 30),
 *  excluding cancelled rows and rows without a next billing date.  Sorted by
 *  ascending date so the soonest renewal is first. */
export function upcomingRenewals(
  subs: Subscription[],
  withinDays: number = 30,
  today: Date = new Date(),
): Subscription[] {
  return subs
    .filter((s) => s.status !== 'cancelled' && s.nextBillingDate)
    .filter((s) => {
      const d = daysUntil(s.nextBillingDate as string, today);
      return d >= 0 && d <= withinDays;
    })
    .sort((a, b) => (a.nextBillingDate as string).localeCompare(b.nextBillingDate as string));
}

/**
 * Advance a yyyy-MM-dd date by one billing cycle.  Used to "roll forward" a
 * subscription's `nextBillingDate` after the previous renewal has passed,
 * keeping the cost summary accurate without nagging the user to update each
 * row by hand.  Returns the new date string (yyyy-MM-dd).
 */
export function advanceByCycle(
  date: string,
  cycle: SubscriptionBillingCycle,
  customCycleDays: number | null,
): string {
  const start = new Date(`${date}T00:00:00`);
  if (Number.isNaN(start.getTime())) return date;
  if (cycle === 'monthly') {
    start.setMonth(start.getMonth() + 1);
  } else if (cycle === 'yearly') {
    start.setFullYear(start.getFullYear() + 1);
  } else if (cycle === 'weekly') {
    start.setDate(start.getDate() + 7);
  } else if (cycle === 'custom' && customCycleDays && customCycleDays > 0) {
    start.setDate(start.getDate() + Math.round(customCycleDays));
  } else {
    return date;
  }
  const yyyy = start.getFullYear();
  const mm = String(start.getMonth() + 1).padStart(2, '0');
  const dd = String(start.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
