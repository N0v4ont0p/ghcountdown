import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Timer, CalendarBlank, ArrowSquareOut, X } from '@phosphor-icons/react';

interface TrayStatus {
  activeBlockTitle?: string;
  activeBlockRemaining?: string;
  nextBlockTitle?: string;
  nextBlockStartsIn?: string;
  nextEventTitle?: string;
  nextEventCountdown?: string;
}

/**
 * Compact floating widget rendered inside the mini-panel BrowserWindow.
 * Receives live status updates from the main window via IPC (forwarded by the
 * main process) and displays the highest-priority countdown.
 */
export function MiniPanelView() {
  const [status, setStatus] = useState<TrayStatus | null>(null);

  useEffect(() => {
    const electronAPI = (window as Window & { electronAPI?: {
      onTrayStatusUpdate?: (cb: (s: TrayStatus) => void) => (() => void);
    } }).electronAPI;

    if (!electronAPI?.onTrayStatusUpdate) return;
    const unsub = electronAPI.onTrayStatusUpdate((s) => setStatus(s));
    return () => unsub?.();
  }, []);

  function openMainApp() {
    // Closing the mini panel and opening the main window is handled by the
    // tray menu action; here we just send focus back via IPC navigation.
    const electronAPI = (window as Window & { electronAPI?: {
      toggleMiniPanel?: () => void;
    } }).electronAPI;
    electronAPI?.toggleMiniPanel?.();
  }

  // Determine what to display based on priority
  const primary = status?.activeBlockTitle
    ? {
        icon: <Timer size={16} className="text-primary" />,
        label: 'Now',
        title: status.activeBlockTitle,
        countdown: status.activeBlockRemaining ?? '',
      }
    : status?.nextBlockTitle
    ? {
        icon: <Timer size={16} className="text-muted-foreground" />,
        label: 'Next block',
        title: status.nextBlockTitle,
        countdown: status.nextBlockStartsIn ? `in ${status.nextBlockStartsIn}` : '',
      }
    : status?.nextEventTitle
    ? {
        icon: <CalendarBlank size={16} className="text-primary" />,
        label: 'Upcoming',
        title: status.nextEventTitle,
        countdown: status.nextEventCountdown ? `in ${status.nextEventCountdown}` : '',
      }
    : null;

  return (
    <div
      className="flex flex-col h-screen select-none overflow-hidden rounded-2xl"
      style={{ background: 'transparent' }}
    >
      {/* Drag handle / title bar */}
      <div
        className="flex items-center justify-between px-3 pt-3 pb-1 cursor-default"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
          GHCountdown
        </span>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={openMainApp}
            className="p-1 rounded hover:bg-primary/10 transition-colors"
            title="Close mini panel"
          >
            <X size={12} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pb-4 flex flex-col justify-center gap-2">
        {primary ? (
          <motion.div
            key={primary.title}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border bg-card/80 backdrop-blur p-3"
          >
            <div className="flex items-center gap-1.5 mb-1">
              {primary.icon}
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                {primary.label}
              </span>
            </div>
            <p className="text-sm font-semibold leading-tight truncate">{primary.title}</p>
            {primary.countdown ? (
              <p className="text-xl font-semibold tabular-nums text-primary mt-0.5">
                {primary.countdown}
              </p>
            ) : null}
          </motion.div>
        ) : (
          <div className="rounded-xl border bg-card/80 backdrop-blur p-3 text-center">
            <p className="text-xs text-muted-foreground">No active blocks or upcoming events</p>
          </div>
        )}

        <button
          onClick={openMainApp}
          className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <ArrowSquareOut size={11} />
          Open full app
        </button>
      </div>
    </div>
  );
}
