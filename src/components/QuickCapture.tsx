import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createTodo } from '@/db/repositories/todosRepo';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface QuickCaptureProps {
  open: boolean;
  onClose: () => void;
}

export function QuickCapture({ open, onClose }: QuickCaptureProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;

    let priority: 1 | 2 | 3 | 4 | 5 = 3;
    let status: 'inbox' | 'someday' = 'inbox';
    if (/urgent|!!|asap/i.test(text)) priority = 5;
    else if (/important|!/i.test(text)) priority = 4;
    else if (/someday|maybe|eventually/i.test(text)) { priority = 1; status = 'someday'; }

    const durationMatch = text.match(/~?(\d+(?:\.\d+)?)\s*(h|hr|hour|min|m)\b/i);
    const estimatedDurationMin = durationMatch
      ? (durationMatch[2].toLowerCase().startsWith('h') ? Math.round(parseFloat(durationMatch[1]) * 60) : Math.round(parseFloat(durationMatch[1])))
      : null;

    const cleanTitle = text.replace(/~?\d+(?:\.\d+)?\s*(h|hr|hour|min|m)\b/gi, '').trim();

    try {
      await createTodo({
        title: cleanTitle || text,
        status,
        dueAt: null,
        priority,
        projectId: null,
        eventId: null,
      });
      toast.success('Captured');
      onClose();
    } catch {
      toast.error('Failed to capture — try again');
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg p-4"
          >
            <form onSubmit={handleSubmit}>
              <Input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Capture anything... press Enter to save, Esc to cancel"
                className="border-0 shadow-none text-base focus-visible:ring-0 px-0 h-10"
                autoComplete="off"
              />
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              Tip: include "!" for important, "urgent" for critical, "~30m" for duration
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
