import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { getAllTodos } from '@/db/repositories/todosRepo';
import { getAllEvents } from '@/db/repositories/eventsRepo';
import { getAllTimeBlocks } from '@/db/repositories/timeBlocksRepo';
import { getAllProjects } from '@/db/repositories/projectsRepo';
import { searchQuickNotes, deriveNoteTitle } from '@/db/repositories/notesRepo';
import { CheckSquare, CalendarBlank, Clock, Folder, NotePencil } from '@phosphor-icons/react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

interface SearchResult {
  id: string;
  type: 'todo' | 'event' | 'timeBlock' | 'project' | 'note';
  title: string;
  subtitle: string;
  navigateTo: string;
}

interface UniversalSearchProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: string) => void;
  /** Called when the user picks a note result; receives id + active query. */
  onSelectNote?: (id: string, query: string) => void;
}

export function UniversalSearch({ open, onClose, onNavigate, onSelectNote }: UniversalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    // debounce: 150ms delay before searching
    const DEBOUNCE_MS = 150;
    const timer = setTimeout(async () => {
      const q = query.toLowerCase();
      const [todos, events, blocks, projects, notes] = await Promise.all([
        getAllTodos(),
        getAllEvents(),
        getAllTimeBlocks(),
        getAllProjects(),
        searchQuickNotes({ query, limit: 4 }),
      ]);
      const out: SearchResult[] = [
        ...todos
          .filter(t => t.title.toLowerCase().includes(q))
          .slice(0, 4)
          .map(t => ({ id: t.id, type: 'todo' as const, title: t.title, subtitle: t.status, navigateTo: 'todos' })),
        ...notes
          .map(n => ({
            id: n.id,
            type: 'note' as const,
            title: deriveNoteTitle(n),
            subtitle: n.tags.length > 0 ? n.tags.map(t => '#' + t).join(' ') : 'Note',
            navigateTo: 'notes',
          })),
        ...events
          .filter(e => e.title.toLowerCase().includes(q) || e.tags.some(tag => tag.toLowerCase().includes(q)))
          .slice(0, 4)
          .map(e => ({
            id: e.id,
            type: 'event' as const,
            title: e.title,
            subtitle: format(new Date(e.startsAt), 'MMM d'),
            navigateTo: 'events',
          })),
        ...blocks
          .filter(b => b.title.toLowerCase().includes(q))
          .slice(0, 4)
          .map(b => ({
            id: b.id,
            type: 'timeBlock' as const,
            title: b.title,
            subtitle: `${b.date} ${b.startTime}`,
            navigateTo: 'timeline',
          })),
        ...projects
          .filter(p => p.name.toLowerCase().includes(q))
          .slice(0, 4)
          .map(p => ({ id: p.id, type: 'project' as const, title: p.name, subtitle: 'Project', navigateTo: 'todos' })),
      ];
      setResults(out);
      setSelectedIndex(0);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      navigate(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  function navigate(result: SearchResult) {
    if (result.type === 'note' && onSelectNote) {
      onSelectNote(result.id, query);
    }
    onNavigate(result.navigateTo);
    onClose();
  }

  const typeIcon: Record<SearchResult['type'], React.ElementType> = {
    todo: CheckSquare,
    event: CalendarBlank,
    timeBlock: Clock,
    project: Folder,
    note: NotePencil,
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg p-0 overflow-hidden gap-0" onKeyDown={handleKeyDown}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search</DialogTitle>
          <DialogDescription>Search todos, events, time blocks, and projects</DialogDescription>
        </DialogHeader>
        <div className="p-3 border-b">
          <Input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search todos, notes, events, blocks, projects..."
            className="border-0 shadow-none focus-visible:ring-0 text-base px-0 h-9"
          />
        </div>
        {results.length > 0 && (
          <div className="max-h-80 overflow-y-auto">
            {results.map((result, i) => {
              const Icon = typeIcon[result.type];
              return (
                <div
                  key={result.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors',
                    i === selectedIndex ? 'bg-accent' : 'hover:bg-accent/50'
                  )}
                  onClick={() => navigate(result)}
                >
                  <Icon size={16} className="text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{result.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">{result.subtitle}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-4 shrink-0 capitalize">
                    {result.type === 'timeBlock' ? 'block' : result.type}
                  </Badge>
                </div>
              );
            })}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No results found</div>
        )}
        {!query.trim() && (
          <div className="p-4 text-xs text-muted-foreground text-center">
            Type to search todos, notes, events, time blocks, and projects
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
