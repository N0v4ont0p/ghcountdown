import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Keyboard, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface InputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputType?: 'text' | 'number' | 'textarea';
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: (value: string) => void;
  onCancel?: () => void;
  validate?: (value: string) => boolean | string;
}

export function InputDialog({
  open,
  onOpenChange,
  title,
  description,
  inputLabel,
  inputPlaceholder = 'Enter value...',
  inputType = 'text',
  defaultValue = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  validate,
}: InputDialogProps) {
  const [value, setValue] = useState(defaultValue);
  const [error, setError] = useState<string>('');

  const handleConfirm = () => {
    if (validate) {
      const result = validate(value);
      if (result === false || typeof result === 'string') {
        setError(typeof result === 'string' ? result : 'Invalid input');
        return;
      }
    }
    onConfirm(value);
    onOpenChange(false);
    setValue('');
    setError('');
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
    setValue('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && inputType !== 'textarea') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={handleCancel}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ 
                type: 'spring',
                damping: 25,
                stiffness: 300,
              }}
              className="pointer-events-auto relative w-full max-w-md"
            >
              <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
                <button
                  onClick={handleCancel}
                  className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-accent transition-colors"
                >
                  <X size={20} className="text-muted-foreground" />
                </button>

                <div className="p-6 bg-gradient-to-br from-primary/10 to-primary/5">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ 
                      type: 'spring',
                      delay: 0.1,
                      damping: 15,
                      stiffness: 300,
                    }}
                    className="inline-flex"
                  >
                    <Keyboard size={48} className="text-primary" weight="duotone" />
                  </motion.div>
                </div>

                <div className="p-6 space-y-4">
                  <div className="space-y-2">
                    <motion.h3
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                      className="text-xl font-semibold"
                    >
                      {title}
                    </motion.h3>
                    {description && (
                      <motion.p
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 }}
                        className="text-sm text-muted-foreground"
                      >
                        {description}
                      </motion.p>
                    )}
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                    className="space-y-2"
                  >
                    {inputLabel && <Label>{inputLabel}</Label>}
                    {inputType === 'textarea' ? (
                      <Textarea
                        value={value}
                        onChange={(e) => {
                          setValue(e.target.value);
                          setError('');
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={inputPlaceholder}
                        className={cn(
                          'min-h-[100px]',
                          error && 'border-destructive focus-visible:ring-destructive'
                        )}
                        autoFocus
                      />
                    ) : (
                      <Input
                        type={inputType}
                        value={value}
                        onChange={(e) => {
                          setValue(e.target.value);
                          setError('');
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={inputPlaceholder}
                        className={cn(
                          error && 'border-destructive focus-visible:ring-destructive'
                        )}
                        autoFocus
                      />
                    )}
                    <AnimatePresence>
                      {error && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-sm text-destructive"
                        >
                          {error}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="flex gap-3 pt-2"
                  >
                    <Button
                      variant="outline"
                      onClick={handleCancel}
                      className="flex-1 hover:scale-[1.02] active:scale-[0.98] transition-transform"
                    >
                      {cancelText}
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      className="flex-1 hover:scale-[1.02] active:scale-[0.98] transition-transform"
                    >
                      {confirmText}
                    </Button>
                  </motion.div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
