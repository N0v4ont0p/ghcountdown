/**
 * Cross-window data-change notification helper.
 *
 * Use this after any successful write to IndexedDB so every renderer (the
 * main app, the launcher window, the mini-panel) re-fetches and stays
 * consistent.  Two hops are required:
 *
 *   1. A local DOM event (`ghc-data-changed`) so listeners inside *this*
 *      window refresh — every view in `App.tsx` already subscribes.
 *   2. An Electron IPC notification (`electronAPI.notifyDataChanged`) so the
 *      main process can re-broadcast a `data:changed` event to every other
 *      BrowserWindow.  The main app re-dispatches that as `ghc-data-changed`
 *      so its views refresh exactly the same way.
 *
 * Both hops are best-effort and never throw — a failure to notify must not
 * mask the underlying successful write.
 */
export interface DataChangedDetail {
  /** Coarse category of what changed; consumers can use this to decide
   *  whether to re-fetch.  Optional — listeners can also just refetch on
   *  every event. */
  kind?: 'todo' | 'note' | 'event' | 'goal' | 'project' | 'timeBlock' | 'timeEntry' | 'settings' | string;
}

interface ElectronDataAPI {
  notifyDataChanged?: (payload?: unknown) => void;
}

export function broadcastDataChanged(detail: DataChangedDetail = {}): void {
  // 1) Same-window listeners (every view in App.tsx).
  try {
    window.dispatchEvent(new CustomEvent('ghc-data-changed', { detail }));
  } catch {
    /* dispatchEvent itself shouldn't throw, but never mask a successful save */
  }
  // 2) Cross-window listeners via Electron IPC (no-op in plain web mode).
  try {
    const api = (window as Window & { electronAPI?: ElectronDataAPI }).electronAPI;
    api?.notifyDataChanged?.(detail);
  } catch (err) {
    // Log but don't propagate — the write succeeded; only the refresh hint
    // failed, which the user can recover from with a manual reload.
    console.error('[dataSync] notifyDataChanged failed:', err);
  }
}
