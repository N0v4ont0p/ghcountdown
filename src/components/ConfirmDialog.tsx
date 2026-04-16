import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { 
  CheckCircle, 
  Warning, 
  Info, 
  X, 
  Trash,
  CheckSquare,
  Archive,
  ClockCounterClockwise,
  XCircle,
  FloppyDisk,
  Icon
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

type ActionType = 'delete' | 'complete' | 'archive' | 'restore' | 'cancel' | 'save' | 'default' | 'warning' | 'info';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  actionType?: ActionType;
  variant?: 'default' | 'destructive' | 'warning' | 'info';
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ActionConfig {
  icon: Icon;
  iconColor: string;
  bgGradient: string;
  iconBg: string;
  iconAnimation: {
    initial: Record<string, any>;
    animate: Record<string, any>;
    transition: Record<string, any>;
  };
  buttonVariant: 'default' | 'destructive';
  particles: boolean;
  particleColor?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  actionType = 'default',
  variant,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [isConfirming, setIsConfirming] = useState(false);

  const handleConfirm = async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      console.error('Confirm action failed:', error);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancel = () => {
    if (isConfirming) return;
    onCancel?.();
    onOpenChange(false);
  };

  const actionTypeConfig: Record<ActionType, ActionConfig> = {
    delete: {
      icon: Trash,
      iconColor: 'text-red-500',
      bgGradient: 'from-red-500/15 via-red-500/10 to-red-500/5',
      iconBg: 'bg-red-500/10',
      iconAnimation: {
        initial: { scale: 0, rotate: -180, opacity: 0 },
        animate: { 
          scale: [0, 1.2, 1],
          rotate: [-180, 10, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 12,
          stiffness: 200,
          delay: 0.1,
        },
      },
      buttonVariant: 'destructive',
      particles: true,
      particleColor: 'bg-red-500',
    },
    complete: {
      icon: CheckSquare,
      iconColor: 'text-green-500',
      bgGradient: 'from-green-500/15 via-green-500/10 to-green-500/5',
      iconBg: 'bg-green-500/10',
      iconAnimation: {
        initial: { scale: 0, y: 20, opacity: 0 },
        animate: { 
          scale: [0, 1.15, 0.95, 1],
          y: [20, -5, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 15,
          stiffness: 250,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: true,
      particleColor: 'bg-green-500',
    },
    archive: {
      icon: Archive,
      iconColor: 'text-amber-500',
      bgGradient: 'from-amber-500/15 via-amber-500/10 to-amber-500/5',
      iconBg: 'bg-amber-500/10',
      iconAnimation: {
        initial: { scale: 0, y: -20, opacity: 0 },
        animate: { 
          scale: [0, 1.1, 1],
          y: [-20, 5, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 14,
          stiffness: 220,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
    restore: {
      icon: ClockCounterClockwise,
      iconColor: 'text-blue-500',
      bgGradient: 'from-blue-500/15 via-blue-500/10 to-blue-500/5',
      iconBg: 'bg-blue-500/10',
      iconAnimation: {
        initial: { scale: 0, rotate: -90, opacity: 0 },
        animate: { 
          scale: [0, 1.1, 1],
          rotate: [-90, 10, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 13,
          stiffness: 230,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
    cancel: {
      icon: XCircle,
      iconColor: 'text-orange-500',
      bgGradient: 'from-orange-500/15 via-orange-500/10 to-orange-500/5',
      iconBg: 'bg-orange-500/10',
      iconAnimation: {
        initial: { scale: 0, rotate: 90, opacity: 0 },
        animate: { 
          scale: [0, 1.2, 1],
          rotate: [90, -10, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 12,
          stiffness: 210,
          delay: 0.1,
        },
      },
      buttonVariant: 'destructive',
      particles: false,
    },
    save: {
      icon: FloppyDisk,
      iconColor: 'text-purple-500',
      bgGradient: 'from-purple-500/15 via-purple-500/10 to-purple-500/5',
      iconBg: 'bg-purple-500/10',
      iconAnimation: {
        initial: { scale: 0, y: -15, opacity: 0 },
        animate: { 
          scale: [0, 1.1, 1],
          y: [-15, 3, 0],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 14,
          stiffness: 240,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
    default: {
      icon: CheckCircle,
      iconColor: 'text-primary',
      bgGradient: 'from-primary/15 via-primary/10 to-primary/5',
      iconBg: 'bg-primary/10',
      iconAnimation: {
        initial: { scale: 0, opacity: 0 },
        animate: { 
          scale: [0, 1.1, 1],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 15,
          stiffness: 250,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
    warning: {
      icon: Warning,
      iconColor: 'text-amber-500',
      bgGradient: 'from-amber-500/15 via-amber-500/10 to-amber-500/5',
      iconBg: 'bg-amber-500/10',
      iconAnimation: {
        initial: { scale: 0, y: -10, opacity: 0 },
        animate: { 
          scale: [0, 1.15, 1],
          y: [-10, 0],
          opacity: 1,
          rotate: [0, -5, 5, -5, 0],
        },
        transition: { 
          type: 'spring',
          damping: 10,
          stiffness: 200,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
    info: {
      icon: Info,
      iconColor: 'text-blue-500',
      bgGradient: 'from-blue-500/15 via-blue-500/10 to-blue-500/5',
      iconBg: 'bg-blue-500/10',
      iconAnimation: {
        initial: { scale: 0, opacity: 0 },
        animate: { 
          scale: [0, 1.2, 1],
          opacity: 1,
        },
        transition: { 
          type: 'spring',
          damping: 15,
          stiffness: 250,
          delay: 0.1,
        },
      },
      buttonVariant: 'default',
      particles: false,
    },
  };

  const config = actionTypeConfig[actionType];
  const IconComponent = config.icon;
  const finalVariant: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link' | null | undefined = 
    variant === 'warning' || variant === 'info' ? 'default' : (variant || config.buttonVariant);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-md z-50"
            onClick={handleCancel}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ 
                opacity: 0, 
                scale: isConfirming ? 1.05 : 0.9, 
                y: isConfirming ? -10 : 30,
              }}
              transition={{ 
                type: 'spring',
                damping: 25,
                stiffness: 350,
              }}
              className="pointer-events-auto relative w-full max-w-md"
            >
              <div className="bg-card border border-border rounded-3xl shadow-2xl overflow-hidden relative">
                <motion.button
                  onClick={handleCancel}
                  whileHover={{ scale: 1.1, rotate: 90 }}
                  whileTap={{ scale: 0.9 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 400 }}
                  className="absolute top-4 right-4 z-10 p-2 rounded-full hover:bg-accent/80 transition-colors"
                >
                  <X size={20} className="text-muted-foreground" />
                </motion.button>

                <div className={cn('relative p-8 bg-gradient-to-br overflow-hidden', config.bgGradient)}>
                  {config.particles && (
                    <div className="absolute inset-0 overflow-hidden">
                      {[...Array(8)].map((_, i) => (
                        <motion.div
                          key={i}
                          initial={{ 
                            opacity: 0, 
                            scale: 0,
                            x: 0,
                            y: 0,
                          }}
                          animate={{ 
                            opacity: [0, 0.6, 0],
                            scale: [0, 1, 0],
                            x: [0, (Math.random() - 0.5) * 100],
                            y: [0, (Math.random() - 0.5) * 100],
                          }}
                          transition={{
                            duration: 1,
                            delay: 0.15 + i * 0.05,
                            ease: 'easeOut',
                          }}
                          className={cn(
                            'absolute left-1/2 top-1/2 w-2 h-2 rounded-full',
                            config.particleColor || ''
                          )}
                          style={{
                            transform: 'translate(-50%, -50%)',
                          }}
                        />
                      ))}
                    </div>
                  )}

                  <motion.div
                    className={cn(
                      'inline-flex p-4 rounded-2xl relative',
                      config.iconBg
                    )}
                    {...config.iconAnimation}
                  >
                    <IconComponent size={56} className={cn(config.iconColor)} weight="duotone" />
                  </motion.div>

                  {actionType === 'delete' && (
                    <motion.div
                      initial={{ scaleY: 0, opacity: 0 }}
                      animate={{ scaleY: 1, opacity: 0.15 }}
                      transition={{ delay: 0.3, duration: 0.3 }}
                      className="absolute bottom-0 left-0 right-0 h-1 bg-red-500 origin-left"
                    />
                  )}
                  {actionType === 'complete' && (
                    <motion.div
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 0.3 }}
                      transition={{ delay: 0.35, duration: 0.4 }}
                      className="absolute top-6 right-6"
                    >
                      <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                        <motion.path
                          d="M8 20L16 28L32 12"
                          stroke="rgb(34 197 94)"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ delay: 0.4, duration: 0.5 }}
                        />
                      </svg>
                    </motion.div>
                  )}
                </div>

                <div className="p-6 space-y-5">
                  <div className="space-y-2">
                    <motion.h3
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2, type: 'spring', damping: 20, stiffness: 300 }}
                      className="text-2xl font-semibold"
                    >
                      {title}
                    </motion.h3>
                    {description && (
                      <motion.p
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.25, type: 'spring', damping: 20, stiffness: 300 }}
                        className="text-muted-foreground leading-relaxed"
                      >
                        {description}
                      </motion.p>
                    )}
                  </div>

                  <motion.div
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, type: 'spring', damping: 20, stiffness: 300 }}
                    className="flex gap-3 pt-2"
                  >
                    <motion.div
                      className="flex-1"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button
                        variant="outline"
                        onClick={handleCancel}
                        className="w-full shadow-sm hover:shadow-md transition-shadow"
                        disabled={isConfirming}
                      >
                        {cancelText}
                      </Button>
                    </motion.div>
                    <motion.div
                      className="flex-1"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <Button
                        variant={finalVariant}
                        onClick={handleConfirm}
                        className="w-full shadow-sm hover:shadow-md transition-shadow relative overflow-hidden"
                        disabled={isConfirming}
                      >
                        {isConfirming && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: '100%' }}
                            transition={{ duration: 0.3 }}
                            className="absolute left-0 top-0 bottom-0 bg-white/20"
                          />
                        )}
                        <span className="relative z-10">{confirmText}</span>
                      </Button>
                    </motion.div>
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
