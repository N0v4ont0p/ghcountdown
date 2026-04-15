'use strict';

// Preload script — runs in an isolated context before the renderer page loads.
// contextIsolation is enabled, so the renderer cannot access Node.js APIs.
// No additional bridge APIs are needed: the app uses IndexedDB directly.
