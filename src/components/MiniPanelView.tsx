import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Timer, CalendarBlank, X, ClockCountdown, MagnifyingGlass, Plus, ArrowSquareOut, CheckSquare } from '@phosphor-icons/react';
import { useTheme } from '@/hooks/use-theme';

interface TrayStatus {
  activeBlockTitle?: string;
  activeBlockRemaining?: string;
  activeBlockPercent?: number;
  nextBlockTitle?: string;
  nextBlockStartsIn?: string;
  nextEventTitle?: string;
  nextEventCountdown?: string;
  currentTaskTitle?: string;
  unfinishedTodosCount?: number;
  focusMinutesToday?: number;
}

type MiniPanelAction = 'show-main' | 'navigate-timer' | 'quick-capture' | 'search' | 'hide-panel';

function formatFocusTime(minutes: number): string {
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function dispatch(action: MiniPanelAction) {
  (window as Window & { electronAPI?: { miniPanelAction?: (a: string) => void } })
    .electronAPI?.miniPanelAction?.(action);
}

/**
 * Compact floating widget rendered inside the mini-panel BrowserWindow.
 * Receives live status updates from the main window via IPC (forwarded by the
 * main process) and displays active timer, current task, next block/event, and
 * quick-action buttons.
 */
export function MiniPanelView() {
  const [status, setStatus] = useState<TrayStatus | null>(null);

  // Apply the correct dark/light theme class to document.documentElement so
  // Tailwind CSS variables resolve correctly.  Also reacts to system theme
  // changes and to explicit theme changes made in the main app window (picked
  // up via the storage event added in use-theme.ts).
  useTheme();

  useEffect(() => {
    const api = (window as Window & {
      electronAPI?: { onTrayStatusUpdate?: (cb: (s: TrayStatus) => void) => (() => void) };
    }).electronAPI;
    if (!api?.onTrayStatusUpdate) return;
    const unsub = api.onTrayStatusUpdate((s) => setStatus(s));
    return () => unsub?.();
  }, []);

  // Determine the primary (block) card content
  const blockCard = status?.activeBlockTitle
    ? {
        icon: <Timer size={14} weight="fill" className="text-primary" />,
        label: 'Now',
        title: status.activeBlockTitle,
        time: status.activeBlockRemaining ?? '',
        percent: status.activeBlockPercent ?? null,
        accent: true,
      }
    : status?.nextBlockTitle
    ? {
        icon: <Timer size={14} className="text-muted-foreground" />,
        label: 'Next block',
        title: status.nextBlockTitle,
        time: status.nextBlockStartsIn ? `in ${status.nextBlockStartsIn}` : '',
        percent: null,
        accent: false,
      }
    : null;

  // Secondary row — next event or nothing
  const eventRow = status?.nextEventTitle
    ? { title: status.nextEventTitle, countdown: status.nextEventCountdown ?? '' }
    : null;

  // Today summary
  const todosCount = status?.unfinishedTodosCount ?? 0;
  const focusMins = status?.focusMinutesToday ?? 0;
  const focusStr = focusMins > 0 ? formatFocusTime(focusMins) : null;

  return (
    <div
      className="flex flex-col h-screen select-none overflow-hidden rounded-2xl bg-background/90"
      style={{ backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } as React.CSSProperties}
    >
      {/* ── Drag handle / title bar ── */}
      <div
        className="flex items-center justify-between px-3 pt-2.5 pb-1 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
          GHCountdown
        </span>
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => dispatch('show-main')}
            className="p-1 rounded hover:bg-primary/10 transition-colors text-muted-foreground hover:text-foreground"
            title="Open full app"
          >
            <ArrowSquareOut size={11} />
          </button>
          <button
            onClick={() => dispatch('hide-panel')}
            className="p-1 rounded hover:bg-destructive/15 transition-colors text-muted-foreground hover:text-destructive"
            title="Hide panel"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col gap-1.5 px-3 pb-2 min-h-0 overflow-hidden">

        {/* Block / timer card */}
        <AnimatePresence mode="wait">
          {blockCard ? (
            <motion.div
              key={blockCard.title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="rounded-xl border bg-card/70 p-2.5"
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {blockCard.icon}
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-medium">
                  {blockCard.label}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold leading-tight truncate flex-1">{blockCard.title}</p>
                {blockCard.time && (
                  <p className={`text-sm font-semibold tabular-nums flex-shrink-0 ${blockCard.accent ? 'text-primary' : 'text-muted-foreground'}`}>
                    {blockCard.time}
                  </p>
                )}
              </div>
              {/* Progress bar — only for active block */}
              {blockCard.percent !== null && (
                <div className="mt-1.5 h-1 rounded-full bg-primary/15 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    initial={false}
                    animate={{ width: `${Math.max(0, Math.min(100, blockCard.percent))}%` }}
                    transition={{ duration: 0.8, ease: 'linear' }}
                  />
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="no-block"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="rounded-xl border bg-card/50 p-2.5 flex items-center gap-2"
            >
              <ClockCountdown size={14} className="text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground">No active or upcoming blocks</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Current task row */}
        {status?.currentTaskTitle && (
          <div className="rounded-xl border bg-card/60 px-2.5 py-2 flex items-center gap-2">
            <CheckSquare size={13} className="text-muted-foreground flex-shrink-0" />
            <p className="text-xs font-medium truncate flex-1">{status.currentTaskTitle}</p>
            {todosCount > 1 && (
              <span className="text-[10px] text-muted-foreground flex-shrink-0">+{todosCount - 1}</span>
            )}
          </div>
        )}

        {/* Next event row (only if no current task or to supplement) */}
        {eventRow && !status?.activeBlockTitle && (
          <div className="rounded-xl border bg-card/60 px-2.5 py-2 flex items-center gap-2">
            <CalendarBlank size={13} className="text-muted-foreground flex-shrink-0" />
            <p className="text-xs font-medium truncate flex-1">{eventRow.title}</p>
            {eventRow.countdown && (
              <span className="text-[10px] tabular-nums text-primary font-medium flex-shrink-0">
                {eventRow.countdown}
              </span>
            )}
          </div>
        )}

        {/* Today summary (focus time) */}
        {focusStr && (
          <div className="px-1 flex items-center gap-2">
            <Timer size={11} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{focusStr} tracked today</span>
          </div>
        )}

        {/* ── Quick action buttons ── */}
        <div className="mt-auto flex gap-1.5 pt-1">
          <button
            onClick={() => dispatch('navigate-timer')}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border bg-card/60 hover:bg-card px-2 py-1.5 transition-colors text-[11px] font-medium text-muted-foreground hover:text-foreground"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Open Timer"
          >
            <ClockCountdown size={12} />
            Timer
          </button>
          <button
            onClick={() => dispatch('quick-capture')}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border bg-card/60 hover:bg-card px-2 py-1.5 transition-colors text-[11px] font-medium text-muted-foreground hover:text-foreground"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Quick Add"
          >
            <Plus size={12} />
            Add
          </button>
          <button
            onClick={() => dispatch('search')}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg border bg-card/60 hover:bg-card px-2 py-1.5 transition-colors text-[11px] font-medium text-muted-foreground hover:text-foreground"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Search"
          >
            <MagnifyingGlass size={12} />
            Search
          </button>
        </div>
      </div>
    </div>
  );
}
