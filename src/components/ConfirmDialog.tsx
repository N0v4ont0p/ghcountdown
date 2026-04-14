import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { CheckCircle, Warning, Info, X } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  variant?: 'default' | 'destructive' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  variant = 'default',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const variantStyles = {
    default: {
      icon: CheckCircle,
      iconColor: 'text-primary',
      bgGradient: 'from-primary/10 to-primary/5',
    },
    destructive: {
      icon: Warning,
      iconColor: 'text-destructive',
      bgGradient: 'from-destructive/10 to-destructive/5',
    },
    warning: {
      icon: Warning,
      iconColor: 'text-amber-500',
      bgGradient: 'from-amber-500/10 to-amber-500/5',
    },
    info: {
      icon: Info,
      iconColor: 'text-blue-500',
      bgGradient: 'from-blue-500/10 to-blue-500/5',
    },
  };

  const config = variantStyles[variant];
  const Icon = config.icon;

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

                <div className={cn('p-6 bg-gradient-to-br', config.bgGradient)}>
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
                    <Icon size={48} className={cn(config.iconColor)} weight="duotone" />
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
                        className="text-muted-foreground"
                      >
                        {description}
                      </motion.p>
                    )}
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
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
                      variant={variant === 'destructive' ? 'destructive' : 'default'}
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
