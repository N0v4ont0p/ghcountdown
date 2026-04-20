interface UndoEntry { type: string; data: unknown; ts: number; }
let stack: UndoEntry | null = null;
export const pushUndo = (e: UndoEntry) => { stack = e; };
export const popUndo = () => { const e = stack; stack = null; return e; };
export const canUndo = () => stack !== null && Date.now() - (stack?.ts ?? 0) < 30000;
