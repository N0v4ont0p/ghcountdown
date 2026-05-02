import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import { CreditCard, Plus, Trash, PencilSimple, Calendar, ChartPie, FunnelSimple, X } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import {
  BUILTIN_SUBSCRIPTION_CATEGORIES,
  Subscription,
  SubscriptionBillingCycle,
  SubscriptionStatus,
} from '@/db/schema';
import {
  createSubscription,
  deleteSubscription,
  getAllSubscriptions,
  getAllSubscriptionCategories,
  updateSubscription,
} from '@/db/repositories/subscriptionsRepo';
import {
  categoryBreakdown,
  daysUntil,
  formatCurrency,
  monthlyCostOf,
  totalsByCurrency,
  upcomingRenewals,
  yearlyCostOf,
} from '@/lib/subscriptionsCost';
import { broadcastDataChanged } from '@/lib/dataSync';

const CUSTOM_CATEGORY_VALUE = '__custom__';
const ALL_FILTER = '__all__';
const STATUS_OPTIONS: SubscriptionStatus[] = ['active', 'trial', 'cancelled'];
const CYCLE_OPTIONS: SubscriptionBillingCycle[] = ['weekly', 'monthly', 'yearly', 'custom'];

const STATUS_BADGE: Record<SubscriptionStatus, string> = {
  active: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300',
  trial: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
  cancelled: 'bg-muted border-border text-muted-foreground line-through',
};

interface FormState {
  name: string;
  category: string;
  /** Sentinel for the category select: either a built-in/known value or
   *  `CUSTOM_CATEGORY_VALUE` to enable the free-form input below it. */
  categorySelect: string;
  /** Stored as string in form state so the input is controlled cleanly; we
   *  parse on submit. */
  price: string;
  currency: string;
  billingCycle: SubscriptionBillingCycle;
  customCycleDays: string;
  nextBillingDate: string;
  status: SubscriptionStatus;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  category: 'AI',
  categorySelect: 'AI',
  price: '',
  currency: 'USD',
  billingCycle: 'monthly',
  customCycleDays: '',
  nextBillingDate: '',
  status: 'active',
  notes: '',
};

export function SubscriptionsView() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [knownCategories, setKnownCategories] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string>(ALL_FILTER);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_FILTER);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [all, cats] = await Promise.all([getAllSubscriptions(), getAllSubscriptionCategories()]);
    setSubs(all);
    setKnownCategories(cats);
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => { void refresh(); };
    window.addEventListener('ghc-data-changed', onChange);
    window.addEventListener('app:datachange', onChange);
    return () => {
      window.removeEventListener('ghc-data-changed', onChange);
      window.removeEventListener('app:datachange', onChange);
    };
  }, [refresh]);

  // ── Derived UI data ──────────────────────────────────────────────────
  /** Union of built-in categories and any custom ones found in saved rows.
   *  Built-ins come first to match the data model's documented ordering;
   *  custom ones are appended alphabetically. */
  const allCategoryOptions = useMemo(() => {
    const builtins = new Set<string>(BUILTIN_SUBSCRIPTION_CATEGORIES);
    const customs = knownCategories.filter((c) => !builtins.has(c)).sort((a, b) => a.localeCompare(b));
    return [...BUILTIN_SUBSCRIPTION_CATEGORIES, ...customs];
  }, [knownCategories]);

  const filteredSubs = useMemo(() => {
    return subs.filter((s) => {
      if (categoryFilter !== ALL_FILTER && s.category !== categoryFilter) return false;
      if (statusFilter !== ALL_FILTER && s.status !== statusFilter) return false;
      return true;
    });
  }, [subs, categoryFilter, statusFilter]);

  const totals = useMemo(() => totalsByCurrency(subs), [subs]);
  const renewals = useMemo(() => upcomingRenewals(subs, 30), [subs]);
  /** Currency to drive the category breakdown.  We pick the currency with
   *  the largest monthly total so the chart describes the user's "main"
   *  spend; if there are no active subs `null` is returned and the UI hides
   *  the breakdown. */
  const breakdownCurrency = totals[0]?.currency ?? null;
  const breakdown = useMemo(
    () => (breakdownCurrency ? categoryBreakdown(subs, breakdownCurrency) : []),
    [subs, breakdownCurrency],
  );

  // ── Dialog handlers ──────────────────────────────────────────────────
  function openAddDialog() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setIsDialogOpen(true);
  }

  function openEditDialog(sub: Subscription) {
    const isBuiltinCat = (BUILTIN_SUBSCRIPTION_CATEGORIES as readonly string[]).includes(sub.category);
    setEditing(sub);
    setForm({
      name: sub.name,
      category: sub.category,
      categorySelect: isBuiltinCat ? sub.category : CUSTOM_CATEGORY_VALUE,
      price: sub.price > 0 ? String(sub.price) : '',
      currency: sub.currency || 'USD',
      billingCycle: sub.billingCycle,
      customCycleDays: sub.customCycleDays ? String(sub.customCycleDays) : '',
      nextBillingDate: sub.nextBillingDate ?? '',
      status: sub.status,
      notes: sub.notes,
    });
    setIsDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error('Please enter a name');
      return;
    }
    const priceNum = parseFloat(form.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error('Please enter a valid price');
      return;
    }
    const category = form.categorySelect === CUSTOM_CATEGORY_VALUE
      ? (form.category.trim() || 'Other')
      : form.categorySelect;
    if (form.billingCycle === 'custom') {
      const days = parseInt(form.customCycleDays, 10);
      if (!Number.isFinite(days) || days <= 0) {
        toast.error('Custom cycle requires a positive number of days');
        return;
      }
    }
    const payload = {
      name,
      category,
      price: priceNum,
      currency: form.currency.trim().toUpperCase() || 'USD',
      billingCycle: form.billingCycle,
      customCycleDays: form.billingCycle === 'custom' ? parseInt(form.customCycleDays, 10) : null,
      nextBillingDate: form.nextBillingDate || null,
      status: form.status,
      notes: form.notes,
      projectId: editing?.projectId ?? null,
    };
    try {
      if (editing) {
        await updateSubscription(editing.id, payload);
        toast.success(`Updated "${name}"`);
      } else {
        await createSubscription(payload);
        toast.success(`Added "${name}"`);
      }
      broadcastDataChanged({ kind: 'subscription' });
      setIsDialogOpen(false);
      void refresh();
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : String(err);
      toast.error(`Failed to save subscription: ${detail}`);
    }
  }

  async function handleDelete(id: string) {
    const sub = subs.find((s) => s.id === id);
    try {
      await deleteSubscription(id);
      toast.success(sub ? `Deleted "${sub.name}"` : 'Subscription deleted');
      broadcastDataChanged({ kind: 'subscription' });
      void refresh();
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : String(err);
      toast.error(`Failed to delete subscription: ${detail}`);
    } finally {
      setConfirmDeleteId(null);
    }
  }

  function clearFilters() {
    setCategoryFilter(ALL_FILTER);
    setStatusFilter(ALL_FILTER);
  }

  const hasActiveFilters = categoryFilter !== ALL_FILTER || statusFilter !== ALL_FILTER;

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard size={24} weight="duotone" className="text-primary" />
            Subscriptions
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Track recurring spend on AI tools, content, productivity apps, and more — all stored locally.
          </p>
        </div>
        <Button onClick={openAddDialog} className="gap-1.5 rounded-xl shrink-0">
          <Plus size={14} weight="bold" />
          Add Subscription
        </Button>
      </div>

      {/* Summary cards */}
      {totals.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Monthly</p>
            <div className="mt-2 space-y-1">
              {totals.map((t) => (
                <p key={`m-${t.currency}`} className="text-2xl font-bold tabular-nums">
                  {formatCurrency(t.monthly, t.currency)}
                </p>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Across {totals.reduce((s, t) => s + t.count, 0)} active subscription
              {totals.reduce((s, t) => s + t.count, 0) === 1 ? '' : 's'}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Yearly</p>
            <div className="mt-2 space-y-1">
              {totals.map((t) => (
                <p key={`y-${t.currency}`} className="text-2xl font-bold tabular-nums">
                  {formatCurrency(t.yearly, t.currency)}
                </p>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Annualized at current cycle</p>
          </Card>

          <Card className="p-5">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Calendar size={12} weight="fill" />
              Renewing in 30 days
            </p>
            <p className="text-2xl font-bold tabular-nums mt-2">{renewals.length}</p>
            {renewals.length > 0 ? (
              <p className="text-xs text-muted-foreground mt-2 truncate">
                Next: {renewals[0].name} · {renewals[0].nextBillingDate}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">No renewals scheduled</p>
            )}
          </Card>
        </div>
      ) : (
        <Card className="p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
            <CreditCard size={26} weight="duotone" className="text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">No subscriptions yet</p>
          <p className="text-xs text-muted-foreground mt-1 mb-4">
            Add your first one to see monthly + yearly cost summaries.
          </p>
          <Button onClick={openAddDialog} size="sm" className="gap-1.5 rounded-xl">
            <Plus size={14} weight="bold" />
            Add Subscription
          </Button>
        </Card>
      )}

      {/* Category breakdown */}
      {breakdown.length > 0 && breakdownCurrency && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <ChartPie size={14} weight="duotone" className="text-primary" />
              Category breakdown
            </h3>
            <p className="text-xs text-muted-foreground">{breakdownCurrency}</p>
          </div>
          <div className="space-y-2">
            {breakdown.map((row) => (
              <div key={row.category}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium">{row.category}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatCurrency(row.monthly, row.currency)} · {Math.round(row.share * 100)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className="h-full bg-primary/80 rounded-full transition-all"
                    style={{ width: `${Math.max(2, Math.round(row.share * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters + list */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FunnelSimple size={12} />
            <span className="font-medium">Filter</span>
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="h-8 w-[160px] text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All categories</SelectItem>
              {allCategoryOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER}>All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 gap-1 text-xs">
              <X size={12} />
              Clear
            </Button>
          )}
          <p className="text-xs text-muted-foreground ml-auto">
            {filteredSubs.length} of {subs.length}
          </p>
        </div>

        {filteredSubs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {subs.length === 0 ? 'No subscriptions yet.' : 'No subscriptions match the current filters.'}
          </p>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {filteredSubs.map((sub) => {
                const monthly = monthlyCostOf(sub);
                const yearly = yearlyCostOf(sub);
                const dUntil = sub.nextBillingDate ? daysUntil(sub.nextBillingDate) : null;
                const renewalSoon = dUntil !== null && dUntil >= 0 && dUntil <= 7;
                return (
                  <motion.div
                    key={sub.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18 }}
                    className="flex items-center gap-3 p-3 rounded-xl border border-border/60 bg-card hover:border-border transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold truncate">{sub.name}</span>
                        <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider', STATUS_BADGE[sub.status])}>
                          {sub.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {sub.category}
                        </Badge>
                        {renewalSoon && (
                          <Badge variant="outline" className="text-[10px] bg-orange-500/10 border-orange-500/30 text-orange-700 dark:text-orange-300">
                            {dUntil === 0 ? 'Renews today' : `Renews in ${dUntil}d`}
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="tabular-nums">
                          {formatCurrency(sub.price, sub.currency)} / {sub.billingCycle === 'custom'
                            ? `${sub.customCycleDays ?? '?'} days`
                            : sub.billingCycle.replace(/ly$/, '')}
                        </span>
                        {sub.status !== 'cancelled' && monthly > 0 && (
                          <span className="tabular-nums">
                            ≈ {formatCurrency(monthly, sub.currency)}/mo · {formatCurrency(yearly, sub.currency)}/yr
                          </span>
                        )}
                        {sub.nextBillingDate && (
                          <span>Next: {format(new Date(`${sub.nextBillingDate}T00:00:00`), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                      {sub.notes && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sub.notes}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEditDialog(sub)}
                        aria-label={`Edit ${sub.name}`}
                      >
                        <PencilSimple size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => setConfirmDeleteId(sub.id)}
                        aria-label={`Delete ${sub.name}`}
                      >
                        <Trash size={14} />
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit subscription' : 'Add subscription'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the details below.' : 'Track a new recurring service.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <Label htmlFor="sub-name">Name</Label>
              <Input
                id="sub-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Netflix"
                autoFocus
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sub-price">Price</Label>
                <Input
                  id="sub-price"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  placeholder="9.99"
                  required
                />
              </div>
              <div>
                <Label htmlFor="sub-currency">Currency</Label>
                <Input
                  id="sub-currency"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
                  placeholder="USD"
                  maxLength={6}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="sub-category">Category</Label>
              <Select
                value={form.categorySelect}
                onValueChange={(v) => setForm((f) => ({
                  ...f,
                  categorySelect: v,
                  category: v === CUSTOM_CATEGORY_VALUE ? f.category : v,
                }))}
              >
                <SelectTrigger id="sub-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allCategoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_CATEGORY_VALUE}>Custom…</SelectItem>
                </SelectContent>
              </Select>
              {form.categorySelect === CUSTOM_CATEGORY_VALUE && (
                <Input
                  className="mt-2"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Custom category name"
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="sub-cycle">Billing cycle</Label>
                <Select
                  value={form.billingCycle}
                  onValueChange={(v) => setForm((f) => ({ ...f, billingCycle: v as SubscriptionBillingCycle }))}
                >
                  <SelectTrigger id="sub-cycle">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CYCLE_OPTIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.billingCycle === 'custom' ? (
                <div>
                  <Label htmlFor="sub-cycle-days">Cycle (days)</Label>
                  <Input
                    id="sub-cycle-days"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={form.customCycleDays}
                    onChange={(e) => setForm((f) => ({ ...f, customCycleDays: e.target.value }))}
                    placeholder="90"
                    required
                  />
                </div>
              ) : (
                <div>
                  <Label htmlFor="sub-status">Status</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm((f) => ({ ...f, status: v as SubscriptionStatus }))}
                  >
                    <SelectTrigger id="sub-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {form.billingCycle === 'custom' && (
              <div>
                <Label htmlFor="sub-status-custom">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as SubscriptionStatus }))}
                >
                  <SelectTrigger id="sub-status-custom">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="sub-next">Next billing date</Label>
              <Input
                id="sub-next"
                type="date"
                value={form.nextBillingDate}
                onChange={(e) => setForm((f) => ({ ...f, nextBillingDate: e.target.value }))}
              />
            </div>

            <div>
              <Label htmlFor="sub-notes">Notes</Label>
              <Textarea
                id="sub-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{editing ? 'Save changes' : 'Add subscription'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => !open && setConfirmDeleteId(null)}
        title="Delete subscription?"
        description="This subscription will be permanently removed. This action cannot be undone."
        confirmText="Delete"
        variant="destructive"
        onConfirm={() => confirmDeleteId && handleDelete(confirmDeleteId)}
      />
    </div>
  );
}
