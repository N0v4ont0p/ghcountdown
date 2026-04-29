import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckSquare, NotePencil, ArrowRight, Command } from '@phosphor-icons/react';
import { useTheme } from '@/hooks/use-theme';
import { createTodo } from '@/db/repositories/todosRepo';
import { createQuickNote, extractInlineTags } from '@/db/repositories/notesRepo';
import { parseTodoInput } from '@/lib/todoParse';

type Mode = 'todo' | 'note';

// How long the success "✓ Added to today" / "✓ Note saved" message stays visible
// in the footer before the keyboard hint reappears.
const FLASH_DURATION_MS = 1100;
// How long the launcher waits after a successful submit before hiding itself,
// giving the user a brief "yes, that worked" confirmation.
const AUTO_HIDE_DELAY_MS = 450;

interface ElectronLauncherAPI {
  hide?: () => void;
  onShow?: (cb: () => void) => () => void;
}

const MODES: Array<{ id: Mode; label: string; placeholder: string; icon: typeof CheckSquare; hint: string }> = [
  {
    id: 'todo',
    label: 'New Todo',
    placeholder: 'What do you need to do?  (try "!" or "~30m")',
    icon: CheckSquare,
    hint: 'Adds to today · ! = important, urgent = critical, ~30m = duration',
  },
  {
    id: 'note',
    label: 'Quick Note',
    placeholder: 'Capture a thought…  (use #tag to file it)',
    icon: NotePencil,
    hint: 'Saved locally · #tag to organize',
  },
];

/**
 * Compact, keyboard-first global launcher window.
 *
 * Lives in its own dedicated Electron BrowserWindow (loaded with `?launcher=1`),
 * shown/hidden by the main process in response to the global shortcut
 * (Option+Cmd+Space on macOS, Ctrl+Alt+Space on Windows).  All user input is
 * captured here; submission goes straight into the local IndexedDB.
 *
 * UX goals:
 *  - obvious selected mode (pill highlight + accent)
 *  - input always auto-focused (including when re-shown)
 *  - Tab and ←/→ switch modes; Enter submits; Escape closes
 */
export function LauncherView() {
  // Apply theme classes to the document root so Tailwind variables resolve.
  useTheme();

  const [mode, setMode] = useState<Mode>('todo');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | null>(null);

  const focusInput = useCallback(() => {
    // Defer so the window has actually rendered/focused first
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  // Initial focus
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  // Re-focus + clear flash whenever the launcher window is shown again
  useEffect(() => {
    const api = (window as Window & { electronAPI?: ElectronLauncherAPI }).electronAPI;
    const unsub = api?.onShow?.(() => {
      setFlash(null);
      focusInput();
    });
    return () => unsub?.();
  }, [focusInput]);

  // Re-focus on window focus too (covers the first show)
  useEffect(() => {
    const onFocus = () => focusInput();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [focusInput]);

  function hide() {
    const api = (window as Window & { electronAPI?: ElectronLauncherAPI }).electronAPI;
    api?.hide?.();
  }

  function showFlash(message: string) {
    setFlash(message);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_DURATION_MS);
  }

  async function submit() {
    const text = value.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'todo') {
        const parsed = parseTodoInput(text);
        await createTodo({
          title: parsed.title,
          status: parsed.status,
          dueAt: null,
          priority: parsed.priority,
          projectId: null,
          eventId: null,
          estimatedMinutes: parsed.estimatedMinutes,
        });
        try { window.dispatchEvent(new Event('ghc-data-changed')); } catch { /* ignore */ }
        showFlash(parsed.status === 'someday' ? 'Saved to someday' : 'Added to today');
      } else {
        // Notes: extract `#tags` from the input so users can categorize on the fly.
        // If the body becomes empty (e.g. user typed only "#idea"), save the
        // empty body — it's a tags-only marker, not the original raw text.
        const { text: body, tags } = extractInlineTags(text);
        if (!body && tags.length === 0) {
          // Defensive: shouldn't happen because submit() short-circuits on
          // empty `text`, but guards against weird whitespace-only inputs.
          showFlash('Nothing to save');
          return;
        }
        await createQuickNote({ text: body, tags });
        try { window.dispatchEvent(new Event('ghc-data-changed')); } catch { /* ignore */ }
        showFlash(tags.length > 0 ? `Note saved · ${tags.map(t => '#' + t).join(' ')}` : 'Note saved');
      }
      setValue('');
      // Keep the window open briefly so the user sees the confirmation,
      // then auto-hide so the launcher feels like a fast capture tool.
      window.setTimeout(() => hide(), AUTO_HIDE_DELAY_MS);
    } catch (err) {
      console.error('[launcher] submit failed:', err);
      showFlash('Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  function cycleMode(direction: 1 | -1) {
    const idx = MODES.findIndex((m) => m.id === mode);
    const next = (idx + direction + MODES.length) % MODES.length;
    setMode(MODES[next].id);
    focusInput();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleMode(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowRight' && (e.metaKey || e.ctrlKey || value.length === 0)) {
      e.preventDefault();
      cycleMode(1);
      return;
    }
    if (e.key === 'ArrowLeft' && (e.metaKey || e.ctrlKey || value.length === 0)) {
      e.preventDefault();
      cycleMode(-1);
      return;
    }
  }

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];
  const ActiveIcon = active.icon;

  return (
    <div
      className="flex h-screen w-screen items-stretch justify-stretch p-2 select-none"
      onMouseDown={(e) => {
        // Clicking the transparent backdrop dismisses the launcher
        if (e.target === e.currentTarget) hide();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex flex-col w-full rounded-2xl border border-border/70 bg-background/95 shadow-2xl ring-1 ring-black/5 overflow-hidden"
        style={{
          backdropFilter: 'blur(24px) saturate(140%)',
          WebkitBackdropFilter: 'blur(24px) saturate(140%)',
          // Make the whole frame draggable except interactive elements
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        {/* ── Mode tabs ── */}
        <div
          className="flex items-center gap-1 px-2 pt-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {MODES.map((m) => {
            const Icon = m.icon;
            const selected = m.id === mode;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setMode(m.id);
                  focusInput();
                }}
                className={
                  'group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ' +
                  (selected
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground')
                }
                aria-pressed={selected}
              >
                <Icon size={13} weight={selected ? 'fill' : 'regular'} />
                {m.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-1 pr-1 text-[10px] uppercase tracking-widest text-muted-foreground/70 font-semibold">
            Launcher
          </div>
        </div>

        {/* ── Input row ── */}
        <div
          className="relative flex items-center gap-2 px-3 pt-2 pb-2.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <ActiveIcon
            size={18}
            weight="fill"
            className="text-primary flex-shrink-0"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={active.placeholder}
            autoFocus
            spellCheck
            className="flex-1 bg-transparent border-0 outline-none text-base placeholder:text-muted-foreground/60 text-foreground"
            // Visual focus indicator is provided by the surrounding ring on the
            // launcher card; the input itself stays clean for a "command bar" feel
          />
          {value.trim().length > 0 && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="flex items-center gap-1 rounded-md bg-primary text-primary-foreground px-2 py-1 text-[11px] font-semibold shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              title="Submit (Enter)"
            >
              {mode === 'todo' ? 'Add' : 'Save'}
              <ArrowRight size={11} weight="bold" />
            </button>
          )}
        </div>

        {/* ── Hint / status footer ── */}
        <div
          className="flex items-center justify-between gap-2 px-3 py-1.5 border-t border-border/60 bg-muted/40 text-[10.5px] text-muted-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <AnimatePresence mode="wait" initial={false}>
            {flash ? (
              <motion.span
                key={flash}
                initial={{ opacity: 0, y: 2 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.15 }}
                className="text-primary font-medium"
              >
                ✓ {flash}
              </motion.span>
            ) : (
              <motion.span
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="truncate"
              >
                <kbd className="px-1 py-0.5 rounded bg-background/80 border border-border/60 font-mono text-[10px]">
                  Enter
                </kbd>{' '}
                {active.hint} ·{' '}
                <kbd className="px-1 py-0.5 rounded bg-background/80 border border-border/60 font-mono text-[10px]">
                  Tab
                </kbd>{' '}
                switch ·{' '}
                <kbd className="px-1 py-0.5 rounded bg-background/80 border border-border/60 font-mono text-[10px]">
                  Esc
                </kbd>{' '}
                close
              </motion.span>
            )}
          </AnimatePresence>
          <span className="flex items-center gap-1 flex-shrink-0 text-muted-foreground/70">
            <Command size={10} />
            <span className="font-mono">{active.label}</span>
          </span>
        </div>
      </motion.div>
    </div>
  );
}
