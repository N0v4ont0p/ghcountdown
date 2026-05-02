import { useMemo, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  ALL_CURATED_ICONS,
  ICON_CATEGORIES,
  ICON_KEYWORDS,
} from '@/lib/iconCatalog';

export interface IconPickerProps {
  /** Currently selected icon string (emoji/glyph), or null/empty when unset. */
  value: string | null;
  /** Called with the new icon string, or `null` when the user clears it. */
  onChange: (value: string | null) => void;
  /** Optional placeholder shown in the trigger when no icon is selected. */
  placeholder?: string;
  /** ID applied to the trigger button (so a `<Label htmlFor>` can target it). */
  id?: string;
  /** Accessible label for the trigger button. */
  ariaLabel?: string;
  /** Disable the picker. */
  disabled?: boolean;
  /** Class names applied to the trigger button. */
  className?: string;
  /** Trigger button size. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * Allow the user to enter a custom emoji/glyph as a fallback.  Defaults to
   * true.  The custom input is intentionally surfaced as an "Advanced" affordance
   * at the bottom of the popover, not the primary UI.
   */
  allowCustom?: boolean;
}

const SIZE_CLASS: Record<NonNullable<IconPickerProps['size']>, string> = {
  sm: 'h-9 w-9 text-base',
  md: 'h-10 w-10 text-xl',
  lg: 'h-12 w-12 text-2xl',
};

/**
 * Filter the curated icon list against a free-text query.  Matches against the
 * literal glyph and any keywords registered in `ICON_KEYWORDS`.  Returns the
 * full list when the query is empty.
 */
function filterIcons(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return ALL_CURATED_ICONS;
  return ALL_CURATED_ICONS.filter((icon) => {
    if (icon.includes(q)) return true;
    const kws = ICON_KEYWORDS[icon];
    if (!kws) return false;
    return kws.some((kw) => kw.includes(q));
  });
}

/**
 * Reusable popover-based icon picker.  Shows a curated set of emojis grouped
 * by category, with a search box, a clear action, and a fallback "Custom"
 * input for users who want to type any glyph.  The stored value is a plain
 * string so it stays compatible with existing `project.icon` / `location.icon`
 * fields.
 */
export function IconPicker({
  value,
  onChange,
  placeholder = '✨',
  id,
  ariaLabel,
  disabled,
  className,
  size = 'md',
  allowCustom = true,
}: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [custom, setCustom] = useState('');

  const filtered = useMemo(() => filterIcons(query), [query]);

  // When searching, ignore the active category and search across everything.
  const visibleIcons = useMemo(() => {
    if (query.trim()) return filtered;
    if (activeCategory === 'all') return ALL_CURATED_ICONS;
    const cat = ICON_CATEGORIES.find((c) => c.id === activeCategory);
    return cat ? cat.icons : ALL_CURATED_ICONS;
  }, [filtered, query, activeCategory]);

  function commit(next: string | null) {
    onChange(next);
    setOpen(false);
    setQuery('');
    setCustom('');
  }

  function handleCustomSubmit() {
    const trimmed = Array.from(custom.trim()).slice(0, 2).join('');
    if (!trimmed) return;
    commit(trimmed);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-label={ariaLabel ?? (value ? `Icon: ${value}. Click to change.` : 'Choose an icon')}
          aria-haspopup="dialog"
          disabled={disabled}
          className={cn(
            'inline-flex items-center justify-center rounded-md border border-input bg-background',
            'shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-50 disabled:pointer-events-none',
            SIZE_CLASS[size],
            className,
          )}
        >
          {value ? (
            <span aria-hidden>{value}</span>
          ) : (
            <span aria-hidden className="text-muted-foreground/70">{placeholder}</span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[320px] p-0 overflow-hidden"
        onOpenAutoFocus={(e) => {
          // Keep focus on our search input rather than the first focusable child.
          e.preventDefault();
        }}
      >
        {/* Header: preview + search + clear */}
        <div className="flex items-center gap-2 p-3 border-b border-border/60">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-md border border-border/60 bg-muted/40 text-xl shrink-0"
            aria-hidden
          >
            {value ?? <span className="text-muted-foreground/50 text-base">∅</span>}
          </div>
          <div className="relative flex-1 min-w-0">
            <MagnifyingGlass
              size={14}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search icons…"
              className="h-9 pl-7 pr-2 text-sm"
              aria-label="Search icons"
            />
          </div>
          {value && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => commit(null)}
              className="h-9 px-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Clear icon"
            >
              <X size={12} />
              Clear
            </Button>
          )}
        </div>

        {/* Category tabs (hidden while searching) */}
        {!query.trim() && (
          <Tabs value={activeCategory} onValueChange={setActiveCategory} className="px-2 pt-2">
            <TabsList className="h-8 w-full overflow-x-auto justify-start gap-0.5 bg-transparent p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsTrigger
                value="all"
                className="h-7 px-2 text-[11px] data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                title="All icons"
              >
                All
              </TabsTrigger>
              {ICON_CATEGORIES.map((cat) => (
                <TabsTrigger
                  key={cat.id}
                  value={cat.id}
                  className="h-7 px-2 text-[11px] data-[state=active]:bg-muted data-[state=active]:shadow-none rounded-md"
                  title={cat.label}
                >
                  <span aria-hidden className="mr-1">{cat.tabIcon}</span>
                  <span className="hidden sm:inline">{cat.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Icon grid */}
        <div
          role="listbox"
          aria-label="Icon options"
          className="max-h-[220px] overflow-y-auto p-2 grid grid-cols-8 gap-1"
        >
          {visibleIcons.length === 0 ? (
            <div className="col-span-8 py-6 text-center text-xs text-muted-foreground">
              No icons match “{query}”.
            </div>
          ) : (
            visibleIcons.map((icon, idx) => {
              const selected = icon === value;
              return (
                <button
                  key={`${icon}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  title={ICON_KEYWORDS[icon]?.[0] ?? icon}
                  onClick={() => commit(icon)}
                  className={cn(
                    'flex items-center justify-center w-9 h-9 rounded-md text-xl',
                    'hover:bg-accent transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected && 'bg-accent ring-2 ring-primary/60',
                  )}
                >
                  <span aria-hidden>{icon}</span>
                </button>
              );
            })
          )}
        </div>

        {/* Custom fallback (advanced) */}
        {allowCustom && (
          <div className="border-t border-border/60 p-2.5 bg-muted/30">
            <label className="block text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Custom (paste any emoji)
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                value={custom}
                onChange={(e) => setCustom(Array.from(e.target.value).slice(0, 2).join(''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCustomSubmit();
                  }
                }}
                placeholder="🚀"
                className="h-8 text-center text-base flex-1"
                aria-label="Custom icon"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleCustomSubmit}
                disabled={!custom.trim()}
                className="h-8"
              >
                Use
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
