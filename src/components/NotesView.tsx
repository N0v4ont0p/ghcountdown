import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format, formatDistanceToNow } from 'date-fns';
import {
  NotePencil,
  Plus,
  Trash,
  MagnifyingGlass,
  Hash,
  X,
  Check,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { cn } from '@/lib/utils';
import { QuickNote } from '@/db/schema';
import {
  getAllQuickNotes,
  createQuickNote,
  updateQuickNote,
  deleteQuickNote,
  getAllNoteTags,
  deriveNoteTitle,
  normalizeTag,
  dedupeTags,
} from '@/db/repositories/notesRepo';
import { broadcastDataChanged } from '@/lib/dataSync';

const AUTOSAVE_DELAY_MS = 450;

interface NotesViewProps {
  /** Optional: pre-select a specific note on first render (e.g. from search). */
  initialSelectedId?: string | null;
  /** Optional: pre-fill the search box. */
  initialQuery?: string;
}

/**
 * Two-pane local Notes browser: list on the left, editor on the right.
 *
 * Responsibilities:
 *  - List, create, edit, delete persistent quick notes (IndexedDB)
 *  - Search by free text across title/body/tags
 *  - Filter by clickable tag chips
 *  - Auto-save the open note (debounced) with a clear "Saved" indicator
 *  - Polished empty / first-time state explaining where notes come from
 */
export function NotesView({ initialSelectedId, initialQuery }: NotesViewProps) {
  const [notes, setNotes] = useState<QuickNote[]>([]);
  const [tagCounts, setTagCounts] = useState<Array<{ tag: string; count: number }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [query, setQuery] = useState<string>(initialQuery ?? '');
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);

  // Keep the editor in sync if the parent passes a new note id (e.g. user
  // picked a search result while NotesView is already mounted).
  useEffect(() => {
    if (initialSelectedId) setSelectedId(initialSelectedId);
  }, [initialSelectedId]);
  useEffect(() => {
    if (initialQuery !== undefined && initialQuery !== '') setQuery(initialQuery);
  }, [initialQuery]);

  // Editor state — kept local so typing stays snappy; debounced into IndexedDB.
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const editTextRef = useRef<HTMLTextAreaElement>(null);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // ── Load + refresh ────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    const [all, tags] = await Promise.all([getAllQuickNotes(), getAllNoteTags()]);
    setNotes(all);
    setTagCounts(tags);
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

  // ── Filtering ─────────────────────────────────────────────────────────
  // Filter is computed client-side over the full list — fast at any sane size,
  // and avoids re-querying the DB on every keystroke.  For very large libraries
  // we'd switch to searchQuickNotes() with debouncing.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = notes;
    if (activeTagFilters.length > 0) {
      list = list.filter((n) => activeTagFilters.every((t) => n.tags.includes(t)));
    }
    if (q) {
      list = list.filter((n) =>
        n.title.toLowerCase().includes(q) ||
        n.text.toLowerCase().includes(q) ||
        n.tags.some((t) => t.includes(q))
      );
    }
    return list;
  }, [notes, query, activeTagFilters]);

  // Auto-select the first visible note when the selection becomes invalid
  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!selectedId || !filtered.some((n) => n.id === selectedId)) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  // ── Editor sync ───────────────────────────────────────────────────────
  // When the user picks a different note (or the underlying note changes),
  // load its fields into the editor state.  Don't clobber unsaved edits if
  // the same note is just being re-fetched after our own save.
  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  const lastLoadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedNote) {
      lastLoadedId.current = null;
      setEditTitle('');
      setEditText('');
      setEditTags([]);
      setIsDirty(false);
      return;
    }
    if (lastLoadedId.current !== selectedNote.id) {
      // Different note picked — flush any pending autosave for the *previous*
      // note FIRST, otherwise React will tear down the autosave effect (deps
      // include `selectedNote`) and the in-flight debounce timer is cancelled,
      // silently losing the user's most recent keystrokes.  This was the
      // "Notes UI doesn't actually save" symptom users were hitting after
      // clicking from one note to another within ~half a second of typing.
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const prev = flushRef.current;
      if (
        prev.isDirty &&
        prev.selectedId &&
        prev.selectedId === lastLoadedId.current
      ) {
        // Best-effort: fire-and-forget, the new selection shouldn't wait on
        // disk I/O for the *previous* note.  Errors are logged so a broken
        // save doesn't appear as a generic UI hang.
        void updateQuickNote(prev.selectedId, {
          title: prev.title,
          text: prev.text,
          tags: prev.tags,
        })
          .then(() => broadcastDataChanged({ kind: 'note' }))
          .catch((err) => console.error('[notes] flush-on-switch save failed:', err));
      }
      // Now load the newly-selected note into the editor
      setEditTitle(selectedNote.title ?? '');
      setEditText(selectedNote.text ?? '');
      setEditTags([...(selectedNote.tags ?? [])]);
      setTagDraft('');
      setIsDirty(false);
      setSavedAt(null);
      lastLoadedId.current = selectedNote.id;
    }
  }, [selectedNote]);

  // Debounced auto-save
  useEffect(() => {
    if (!selectedNote || !isDirty) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await updateQuickNote(selectedNote.id, {
          title: editTitle,
          text: editText,
          tags: editTags,
        });
        setSavedAt(Date.now());
        setIsDirty(false);
        // Notify other windows / views (mini-panel, etc.) so they refresh.
        // Local listeners are fine without this since `refresh()` below also
        // re-renders our own list, but the cross-window IPC keeps everyone
        // consistent with the same write.
        broadcastDataChanged({ kind: 'note' });
        await refresh();
      } catch (err) {
        console.error('[notes] autosave failed:', err);
        const detail = err instanceof Error && err.message ? err.message : String(err);
        // Surface the actual reason instead of a vague "failed to save" so
        // users (and bug reports) know whether it's a quota, blocked upgrade,
        // or transient I/O error.
        toast.error(`Failed to save note: ${detail}`);
      }
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [editTitle, editText, editTags, isDirty, selectedNote, refresh]);

  // Mirror the latest editor state into refs so the unmount-time flush below
  // sees current values (the empty-deps cleanup would otherwise capture stale
  // initial state).
  const flushRef = useRef({
    selectedId: null as string | null,
    isDirty: false,
    title: '',
    text: '',
    tags: [] as string[],
  });
  useEffect(() => {
    flushRef.current = {
      selectedId: selectedNote?.id ?? null,
      isDirty,
      title: editTitle,
      text: editText,
      tags: editTags,
    };
  }, [selectedNote, isDirty, editTitle, editText, editTags]);

  // Cleanup on unmount: flush any pending save synchronously-ish so the user
  // doesn't lose typing when navigating away.  Reads the latest snapshot via
  // flushRef rather than capturing stale state from the effect closure.
  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      const snap = flushRef.current;
      if (snap.selectedId && snap.isDirty) {
        // Best-effort flush — fire and forget.  Notify other windows once
        // the write resolves so the mini-panel refreshes too.
        void updateQuickNote(snap.selectedId, {
          title: snap.title,
          text: snap.text,
          tags: snap.tags,
        })
          .then(() => broadcastDataChanged({ kind: 'note' }))
          .catch((err) => console.error('[notes] unmount flush save failed:', err));
      }
    };
  }, []);

  function markDirty() {
    setIsDirty(true);
  }

  // ── Actions ───────────────────────────────────────────────────────────
  async function handleNew() {
    try {
      const note = await createQuickNote({ text: '', title: '', tags: activeTagFilters });
      // Tell other windows (and our own listeners) immediately so the new
      // note appears everywhere — without this the mini-panel would still
      // see the previous note count until the next mutation.
      broadcastDataChanged({ kind: 'note' });
      await refresh();
      setSelectedId(note.id);
      setQuery('');
      // Focus the body for immediate typing
      requestAnimationFrame(() => editTextRef.current?.focus());
    } catch (err) {
      console.error('[notes] create failed:', err);
      const detail = err instanceof Error && err.message ? err.message : String(err);
      // Tell the user *why* it failed (quota, blocked upgrade, …) rather
      // than a generic message, since the most common cause — a corrupt or
      // locked IndexedDB — is actionable (clear site data / restart).
      toast.error(`Failed to create note: ${detail}`);
    }
  }

  async function handleDelete() {
    if (!selectedNote) return;
    try {
      await deleteQuickNote(selectedNote.id);
      broadcastDataChanged({ kind: 'note' });
      toast.success('Note deleted');
      await refresh();
    } catch (err) {
      console.error('[notes] delete failed:', err);
      const detail = err instanceof Error && err.message ? err.message : String(err);
      toast.error(`Failed to delete note: ${detail}`);
    } finally {
      setConfirmDeleteOpen(false);
    }
  }

  function commitTagDraft() {
    const norm = normalizeTag(tagDraft);
    if (!norm) {
      setTagDraft('');
      return;
    }
    setEditTags((prev) => dedupeTags([...prev, norm]));
    setTagDraft('');
    markDirty();
  }

  function removeTag(tag: string) {
    setEditTags((prev) => prev.filter((t) => t !== tag));
    markDirty();
  }

  function toggleTagFilter(tag: string) {
    setActiveTagFilters((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  // ── Keyboard nav for the list ─────────────────────────────────────────
  function handleListKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (filtered.length === 0) return;
    const idx = filtered.findIndex((n) => n.id === selectedId);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = filtered[Math.min(idx + 1, filtered.length - 1)];
      if (next) setSelectedId(next.id);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = filtered[Math.max(idx - 1, 0)];
      if (next) setSelectedId(next.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      requestAnimationFrame(() => editTextRef.current?.focus());
    }
  }

  // Global shortcuts inside the view
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      // Cmd/Ctrl+N → new note (works even while typing)
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void handleNew();
        return;
      }
      // Cmd/Ctrl+Backspace → delete the open note (only when not typing in body)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Backspace' && !isTyping && selectedNote) {
        e.preventDefault();
        setConfirmDeleteOpen(true);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNote]);

  // ── Render ────────────────────────────────────────────────────────────
  const hasAnyNote = notes.length > 0;
  const showEmptyAll = !hasAnyNote;
  const showEmptyFiltered = hasAnyNote && filtered.length === 0;

  return (
    <div className="flex flex-col gap-4 max-w-7xl">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <NotePencil size={22} weight="duotone" className="text-primary" />
            Notes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Local-only notebook. Add{' '}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[11px]">#tags</code>{' '}
            inline to organize your notes.
          </p>
        </div>
        <Button onClick={handleNew} className="gap-1.5">
          <Plus size={16} weight="bold" />
          New Note
          <span className="ml-1 text-[10px] opacity-70 font-mono">
            {navigator.platform.includes('Mac') ? '⌘N' : 'Ctrl+N'}
          </span>
        </Button>
      </div>

      {/* ── Search + tag filters ── */}
      <div className="flex flex-col gap-2">
        <div className="relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes by title, body, or tag…"
            className="pl-9"
            aria-label="Search notes"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Clear search"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {tagCounts.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground/80 font-semibold mr-1">
              Tags
            </span>
            {tagCounts.slice(0, 18).map(({ tag, count }) => {
              const active = activeTagFilters.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTagFilter(tag)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card hover:bg-muted text-muted-foreground hover:text-foreground border-border',
                  )}
                  aria-pressed={active}
                >
                  <Hash size={10} weight={active ? 'bold' : 'regular'} />
                  {tag}
                  <span className={cn('text-[9px] opacity-70')}>{count}</span>
                </button>
              );
            })}
            {activeTagFilters.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTagFilters([])}
                className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── First-run empty state ── */}
      {showEmptyAll && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-dashed bg-card/50 p-10 text-center"
        >
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <NotePencil size={24} weight="duotone" className="text-primary" />
          </div>
          <h2 className="text-lg font-semibold">No notes yet</h2>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto">
            Create one to capture a thought. Add{' '}
            <code className="px-1 py-0.5 rounded bg-muted text-foreground/80 font-mono text-[11px]">#tags</code>{' '}
            to organize them.
          </p>
          <Button onClick={handleNew} className="mt-4 gap-1.5">
            <Plus size={14} weight="bold" />
            Create your first note
          </Button>
        </motion.div>
      )}

      {/* ── List + Editor pane ── */}
      {hasAnyNote && (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]">
          {/* List */}
          <div
            className="rounded-2xl border bg-card/50 overflow-hidden flex flex-col max-h-[70vh]"
            onKeyDown={handleListKey}
            tabIndex={0}
            role="listbox"
            aria-label="Notes list"
          >
            <div className="px-3 py-2 border-b text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center justify-between">
              <span>{filtered.length} of {notes.length}</span>
              <span className="text-muted-foreground/70">↑↓ navigate</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <AnimatePresence initial={false}>
                {filtered.map((n) => {
                  const selected = n.id === selectedId;
                  const title = deriveNoteTitle(n);
                  const preview = n.text.replace(/\s+/g, ' ').trim().slice(0, 90);
                  return (
                    <motion.button
                      key={n.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => setSelectedId(n.id)}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                      className={cn(
                        'w-full text-left px-3 py-2.5 border-b last:border-b-0 transition-colors',
                        selected
                          ? 'bg-primary/10 border-l-2 border-l-primary'
                          : 'hover:bg-muted/60',
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className={cn('text-sm font-medium truncate', selected && 'text-primary')}>
                          {title}
                        </p>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {formatDistanceToNow(new Date(n.updatedAt ?? n.createdAt), { addSuffix: false })}
                        </span>
                      </div>
                      {preview && preview !== title && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{preview}</p>
                      )}
                      {n.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {n.tags.slice(0, 4).map((t) => (
                            <span
                              key={t}
                              className="text-[9.5px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                            >
                              #{t}
                            </span>
                          ))}
                          {n.tags.length > 4 && (
                            <span className="text-[9.5px] text-muted-foreground/70">
                              +{n.tags.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                    </motion.button>
                  );
                })}
              </AnimatePresence>
              {showEmptyFiltered && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  No notes match your filters.
                  <br />
                  <button
                    type="button"
                    onClick={() => { setQuery(''); setActiveTagFilters([]); }}
                    className="mt-2 text-primary hover:underline"
                  >
                    Clear filters
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Editor */}
          <div className="rounded-2xl border bg-card/50 flex flex-col max-h-[70vh] overflow-hidden">
            {selectedNote ? (
              <>
                {/* Editor header: title + meta + delete */}
                <div className="px-4 py-3 border-b flex items-center gap-2">
                  <Input
                    value={editTitle}
                    placeholder="Untitled note"
                    onChange={(e) => { setEditTitle(e.target.value); markDirty(); }}
                    className="border-0 shadow-none focus-visible:ring-0 text-base font-semibold px-0 h-8"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                    title={`Delete note (${navigator.platform.includes('Mac') ? '⌘⌫' : 'Ctrl+⌫'})`}
                    aria-label="Delete note"
                  >
                    <Trash size={14} />
                  </Button>
                </div>

                {/* Tag editor */}
                <div className="px-4 py-2 border-b flex flex-wrap items-center gap-1.5">
                  {editTags.map((t) => (
                    <Badge
                      key={t}
                      variant="secondary"
                      className="gap-1 pr-1 font-normal"
                    >
                      <Hash size={10} />
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="ml-0.5 p-0.5 rounded hover:bg-background/60 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove tag ${t}`}
                      >
                        <X size={9} />
                      </button>
                    </Badge>
                  ))}
                  <input
                    type="text"
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
                        if (tagDraft.trim()) {
                          e.preventDefault();
                          commitTagDraft();
                        }
                      } else if (e.key === 'Backspace' && !tagDraft && editTags.length > 0) {
                        e.preventDefault();
                        removeTag(editTags[editTags.length - 1]);
                      }
                    }}
                    onBlur={() => { if (tagDraft.trim()) commitTagDraft(); }}
                    placeholder={editTags.length === 0 ? 'Add tags…' : '+ tag'}
                    className="bg-transparent border-0 outline-none text-xs flex-1 min-w-[80px] py-1 placeholder:text-muted-foreground/60"
                    aria-label="Add tag"
                  />
                </div>

                {/* Body */}
                <Textarea
                  ref={editTextRef}
                  value={editText}
                  onChange={(e) => { setEditText(e.target.value); markDirty(); }}
                  placeholder="Start writing… Markdown is fine. Use #tag inline to auto-tag."
                  className="flex-1 resize-none border-0 shadow-none focus-visible:ring-0 rounded-none p-4 text-sm leading-relaxed font-sans"
                />

                {/* Footer: timestamps + save indicator */}
                <div className="px-4 py-2 border-t bg-muted/30 flex items-center justify-between text-[10.5px] text-muted-foreground">
                  <span>
                    Created {format(new Date(selectedNote.createdAt), 'MMM d, yyyy · h:mm a')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {isDirty ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Saving…
                      </>
                    ) : savedAt ? (
                      <>
                        <Check size={11} className="text-emerald-500" />
                        Saved
                      </>
                    ) : (
                      <>
                        Updated {formatDistanceToNow(new Date(selectedNote.updatedAt ?? selectedNote.createdAt), { addSuffix: true })}
                      </>
                    )}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-10 text-center">
                <div>
                  <NotePencil size={28} weight="duotone" className="text-muted-foreground/60 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Select a note from the list, or{' '}
                    <button
                      type="button"
                      onClick={handleNew}
                      className="text-primary hover:underline"
                    >
                      create a new one
                    </button>
                    .
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Delete this note?"
        description="This permanently removes the note from local storage. This cannot be undone."
        actionType="delete"
        confirmText="Delete"
        onConfirm={handleDelete}
      />
    </div>
  );
}
