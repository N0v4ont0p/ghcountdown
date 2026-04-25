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
   * Subscribe to tray-status-update forwarded to the mini-panel window.
   * Returns an unsubscribe function.
   */
  onTrayStatusUpdate: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('tray:status-update', handler);
    return () => ipcRenderer.removeListener('tray:status-update', handler);
  },

  /** Toggle the mini-panel floating window. */
  toggleMiniPanel: () => ipcRenderer.send('mini-panel:toggle'),
});
