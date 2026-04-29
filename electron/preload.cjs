'use strict';

// Preload script — runs in an isolated context before the renderer page loads.
// contextIsolation is enabled, so the renderer cannot access Node.js APIs.
const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal bridge so the renderer can proxy outbound HTTP requests
// through the main process (which is not subject to CORS restrictions).
contextBridge.exposeInMainWorld('electronAPI', {
  // ---------------------------------------------------------------------------
  // AI proxy
  // ---------------------------------------------------------------------------
  aiRequest: (config) => ipcRenderer.invoke('ai-request', config),

  // ---------------------------------------------------------------------------
  // macOS menu bar / tray
  // ---------------------------------------------------------------------------

  /** Send current smart-status data to the tray so the menu & title update. */
  updateTrayStatus: (status) => ipcRenderer.send('tray:update-status', status),

  /**
   * Subscribe to 'app:navigate' messages sent from the tray menu.
   * Returns an unsubscribe function.
   */
  onNavigate: (callback) => {
    const handler = (_event, view) => callback(view);
    ipcRenderer.on('app:navigate', handler);
    return () => ipcRenderer.removeListener('app:navigate', handler);
  },

  /**
   * Subscribe to 'app:open-quick-capture' messages sent from the tray menu.
   * Returns an unsubscribe function.
   */
  onOpenQuickCapture: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:open-quick-capture', handler);
    return () => ipcRenderer.removeListener('app:open-quick-capture', handler);
  },

  /**
   * Subscribe to 'app:open-search' messages sent from the tray menu / mini panel.
   * Returns an unsubscribe function.
   */
  onOpenSearch: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('app:open-search', handler);
    return () => ipcRenderer.removeListener('app:open-search', handler);
  },

  /**
   * Subscribe to tray-status-update forwarded to the mini-panel window.
   * Returns an unsubscribe function.
   */
  onTrayStatusUpdate: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('tray:status-update', handler);
    return () => ipcRenderer.removeListener('tray:status-update', handler);
  },

  /**
   * Subscribe to mini-panel state changes triggered from the main process
   * (e.g. the user manually closes or hides the floating window).
   * Callback receives `{ visible: boolean }`.
   * Returns an unsubscribe function.
   */
  onMiniPanelStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('mini-panel:state-changed', handler);
    return () => ipcRenderer.removeListener('mini-panel:state-changed', handler);
  },

  /** Toggle the mini-panel floating window. */
  toggleMiniPanel: () => ipcRenderer.send('mini-panel:toggle'),

  /**
   * Explicitly show or hide the mini-panel window.
   * Used by the settings switch and the auto-restore on launch.
   */
  setMiniPanelVisible: (visible) => ipcRenderer.send('mini-panel:set-visible', visible),

  /**
   * Trigger a named action from the mini panel.
   * Actions: 'show-main' | 'navigate-timer' | 'quick-capture' | 'search'
   */
  miniPanelAction: (action) => ipcRenderer.send('mini-panel:action', action),

  // ---------------------------------------------------------------------------
  // Global launcher window
  // ---------------------------------------------------------------------------

  /** Hide the launcher popup (called on Escape, submit, or backdrop click). */
  hide: () => ipcRenderer.send('launcher:hide'),

  /**
   * Subscribe to 'launcher:shown' notifications fired by the main process
   * each time the launcher window becomes visible.  The renderer uses this to
   * re-focus the input and clear stale UI state.  Returns an unsubscribe fn.
   */
  onShow: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('launcher:shown', handler);
    return () => ipcRenderer.removeListener('launcher:shown', handler);
  },
});
