'use strict';

// Preload script — runs in an isolated context before the renderer page loads.
// contextIsolation is enabled, so the renderer cannot access Node.js APIs.
const { contextBridge, ipcRenderer } = require('electron');

// Expose a minimal bridge so the renderer can proxy outbound HTTP requests
// through the main process (which is not subject to CORS restrictions).
contextBridge.exposeInMainWorld('electronAPI', {
  aiRequest: (config) => ipcRenderer.invoke('ai-request', config),
});
