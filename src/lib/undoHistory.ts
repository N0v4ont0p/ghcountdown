const STACK_MAX = 10;
const EXPIRY_MS = 30_000;

interface UndoEntry { type: string; data: unknown; ts: number; }
const stack: UndoEntry[] = [];

export const pushUndo = (e: UndoEntry): void => {
  stack.push(e);
  if (stack.length > STACK_MAX) stack.shift();
};

export const popUndo = (): UndoEntry | null => {
  return stack.pop() ?? null;
};

export const canUndo = (): boolean => {
  const top = stack[stack.length - 1];
  return top !== undefined && Date.now() - top.ts < EXPIRY_MS;
};

export const clearUndo = (): void => {
  stack.length = 0;
};
