/**
 * Smarter scheduler for "flex" timeline blocks.
 *
 * A flex block is a placeholder slot the user has reserved on the timeline
 * (e.g. "morning study session") that has no specific todo attached.  The
 * scheduler picks the *best* todo to drop into that slot, given:
 *
 *   - todo priority (1-5)
 *   - due-date urgency (overdue → strong bonus, due today → bonus, …)
 *   - estimated duration vs the available block duration (fits well = bonus,
 *     overflow = penalty)
 *   - project match (flex-project blocks are restricted to their project; a
 *     matching project on a generic flex-todo block is a small bonus)
 *   - cognitive load × day status × time of day (high-cog tasks land best in
 *     peak-focus hours; on sick days low-cog tasks are preferred)
 *   - task age (older tasks get a small staleness bonus to avoid starvation)
 *   - already-scheduled todos are excluded outright (no duplicates)
 *
 * Hard rules (return null):
 *   - vacation / off day status        → never auto-fill
 *   - flex-project block missing match → no candidate
 *   - todo already scheduled today     → excluded
 *   - todo not in 'today' status       → excluded
 *
 * The function is **pure**: no IO, no toasts, no DB writes.  Callers (currently
 * `TimelineView.autoFillFlexBlock` and `scheduleMyDay`'s flex pass) decide
 * what to do with the picked candidate and how to surface the explanation.
 *
 * `explainAutoFill` formats the top reasons into a short toast-friendly
 * string, e.g. "Maths essay — overdue · fits exactly · high priority".
 */

import { Todo, TimeBlock, DayStatusKind } from '@/db/schema';
import { suppressesRoutine, prefersLowCognitiveLoad } from '@/db/repositories/dayStatusRepo';
import { DEFAULT_TODO_MINUTES } from '@/lib/schedulingUtils';

/** Single human-readable reason a candidate scored well (or poorly). */
export interface FillReason {
  /** Short label shown in tooltips / toasts. */
  label: string;
  /** Signed contribution to the total score (positive = pro, negative = con). */
  weight: number;
}

export interface FillCandidateResult {
  todo: Todo;
  /** Sum of all reason weights.  Higher = better. */
  score: number;
  /** Reasons sorted by absolute weight desc.  Useful for explainability UI. */
  reasons: FillReason[];
  /**
   * 0..1 confidence proxy derived from score margin vs the runner-up.  When
   * only one candidate exists, this is 0.5 (we picked something but had no
   * alternative to compare against).
   */
  confidence: number;
}

export interface FlexFillOptions {
  /** Hours that the user typically does deep work (0-23).  Defaults to none. */
  peakHours?: ReadonlyArray<number>;
  /** "Now" reference for urgency / age maths.  Defaults to `new Date()`. */
  now?: Date;
}

/** Minimum score under which we refuse to auto-fill.  Prevents picking a
 *  clearly-wrong task just because nothing else exists.  Calibrated against
 *  the weights below: a non-overdue p1 todo with no other signal scores ~0. */
const MIN_ACCEPT_SCORE = 1;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function blockDurationMinutes(block: Pick<TimeBlock, 'startTime' | 'endTime'>): number {
  const [sH, sM] = block.startTime.split(':').map(Number);
  const [eH, eM] = block.endTime.split(':').map(Number);
  return Math.max(0, (eH * 60 + eM) - (sH * 60 + sM));
}

function blockStartHour(block: Pick<TimeBlock, 'startTime'>): number {
  return Number(block.startTime.split(':')[0]);
}

function todoMinutes(todo: Todo): number {
  return todo.estimatedMinutes && todo.estimatedMinutes > 0
    ? todo.estimatedMinutes
    : DEFAULT_TODO_MINUTES;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Score a single todo against a flex block.  Exposed for unit-test parity and
 * so callers (e.g. ghost-suggestion strips) can reuse the same explanation.
 */
export function scoreTodoForBlock(
  todo: Todo,
  block: Pick<TimeBlock, 'slotType' | 'projectId' | 'startTime' | 'endTime'>,
  dayStatus: DayStatusKind,
  options: FlexFillOptions = {},
): { score: number; reasons: FillReason[] } {
  const reasons: FillReason[] = [];
  const now = options.now ?? new Date();
  const sick = prefersLowCognitiveLoad(dayStatus);
  const blockMins = blockDurationMinutes(block);
  const taskMins = todoMinutes(todo);
  const hour = blockStartHour(block);
  const isPeak = options.peakHours ? options.peakHours.includes(hour) : false;

  // --- Priority (0..4) -----------------------------------------------------
  const priorityWeight = Math.max(0, todo.priority - 1);
  if (priorityWeight > 0) {
    reasons.push({
      label: todo.priority >= 4 ? 'high priority' : `priority ${todo.priority}`,
      weight: priorityWeight,
    });
  }

  // --- Due-date urgency ----------------------------------------------------
  if (todo.dueAt) {
    const dueMs = new Date(todo.dueAt).getTime();
    const diffHours = (dueMs - now.getTime()) / 36e5;
    if (diffHours < 0) {
      reasons.push({ label: 'overdue', weight: 6 });
    } else if (diffHours <= 12) {
      reasons.push({ label: 'due today', weight: 4 });
    } else if (diffHours <= 36) {
      reasons.push({ label: 'due tomorrow', weight: 2.5 });
    } else if (diffHours <= 24 * 7) {
      reasons.push({ label: 'due this week', weight: 1 });
    }
  }

  // --- Duration fit --------------------------------------------------------
  // Reward tasks that comfortably fit; mildly reward tasks that *exactly*
  // fit; penalise tasks that overflow the block.
  if (blockMins > 0) {
    const ratio = taskMins / blockMins;
    if (ratio <= 1) {
      // Closer to 1 == better fit; a 30-min task in a 30-min block scores
      // higher than a 5-min task in a 30-min block.
      reasons.push({ label: ratio >= 0.85 ? 'fits exactly' : 'fits', weight: 1 + ratio });
    } else if (ratio <= 1.25) {
      reasons.push({ label: 'slight overflow', weight: -0.5 });
    } else {
      reasons.push({ label: 'too long for slot', weight: -3 });
    }
  }

  // --- Project match -------------------------------------------------------
  // For 'flex-project' the pool is already filtered to matching projects; we
  // still award a small bonus so explainability can mention it.  For
  // 'flex-todo' a coincidental project match is a tie-breaker.
  if (block.projectId && todo.projectId && block.projectId === todo.projectId) {
    reasons.push({
      label: block.slotType === 'flex-project' ? 'project slot match' : 'project match',
      weight: block.slotType === 'flex-project' ? 2 : 1,
    });
  }

  // --- Cognitive load × day status × time of day ---------------------------
  if (sick) {
    if (todo.cognitiveLoad === 'low') {
      reasons.push({ label: 'low load (sick day)', weight: 3 });
    } else if (todo.cognitiveLoad === 'high') {
      reasons.push({ label: 'high load (sick day)', weight: -3 });
    }
  } else if (todo.cognitiveLoad === 'high') {
    if (isPeak) {
      reasons.push({ label: 'deep work in peak hour', weight: 2 });
    } else if (hour >= 20 || hour < 7) {
      reasons.push({ label: 'deep work late', weight: -2 });
    }
  } else if (todo.cognitiveLoad === 'low' && isPeak) {
    // Don't waste a peak hour on trivia.
    reasons.push({ label: 'low load in peak hour', weight: -1 });
  }

  // --- Task age (staleness bonus, capped) ----------------------------------
  if (todo.createdAt) {
    const ageDays = (now.getTime() - new Date(todo.createdAt).getTime()) / 86_400_000;
    if (ageDays >= 3) {
      const ageBonus = Math.min(2, Math.log2(ageDays));
      reasons.push({ label: `${Math.floor(ageDays)}d old`, weight: ageBonus });
    }
  }

  const score = reasons.reduce((sum, r) => sum + r.weight, 0);
  return { score, reasons };
}

/* -------------------------------------------------------------------------- */
/* Picker                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pick the best todo to drop into a flex block.  Returns `null` when the day
 * status forbids auto-fill, the candidate pool is empty, no todo passes the
 * minimum score threshold, or (for flex-project) the block has no projectId.
 */
export function pickFlexFillCandidate(
  block: Pick<TimeBlock, 'slotType' | 'projectId' | 'startTime' | 'endTime'>,
  allTodos: ReadonlyArray<Todo>,
  scheduledTodoIds: ReadonlySet<string>,
  dayStatus: DayStatusKind,
  options: FlexFillOptions = {},
): FillCandidateResult | null {
  // Hard gate: vacation / off pause auto-fill.
  if (suppressesRoutine(dayStatus)) return null;

  const slotType = block.slotType ?? 'fixed';
  if (slotType === 'fixed') return null;
  // flex-project must specify a project; otherwise we have no constraint
  // and would silently behave like flex-todo, which surprises the user.
  if (slotType === 'flex-project' && !block.projectId) return null;

  let pool = allTodos.filter(
    (t) => t.status === 'today' && !scheduledTodoIds.has(t.id),
  );
  if (slotType === 'flex-project') {
    pool = pool.filter((t) => t.projectId === block.projectId);
  }
  if (pool.length === 0) return null;

  const scored = pool
    .map((todo) => {
      const { score, reasons } = scoreTodoForBlock(todo, block, dayStatus, options);
      return { todo, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (winner.score < MIN_ACCEPT_SCORE) return null;

  // Confidence is the normalised margin between #1 and #2.  When there's no
  // runner-up we report 0.5 so the UI can distinguish "no choice" from a
  // confident pick.
  const runnerUp = scored[1]?.score ?? 0;
  const margin = winner.score - runnerUp;
  const confidence = scored.length === 1
    ? 0.5
    : Math.min(1, Math.max(0, margin / (Math.abs(winner.score) + 1)));

  // Sort reasons by impact (positive first, then by magnitude) for explainability.
  const sortedReasons = [...winner.reasons].sort((a, b) => {
    if ((a.weight >= 0) !== (b.weight >= 0)) return a.weight >= 0 ? -1 : 1;
    return Math.abs(b.weight) - Math.abs(a.weight);
  });

  return {
    todo: winner.todo,
    score: winner.score,
    reasons: sortedReasons,
    confidence,
  };
}

/**
 * Format the top positive reasons from a candidate into a short string,
 * suitable for a toast or tooltip:  "Maths essay — overdue · fits exactly".
 */
export function explainAutoFill(result: FillCandidateResult, maxReasons = 3): string {
  const positive = result.reasons.filter((r) => r.weight > 0).slice(0, maxReasons);
  if (positive.length === 0) return result.todo.title;
  return `${result.todo.title} — ${positive.map((r) => r.label).join(' · ')}`;
}
