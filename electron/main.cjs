'use strict';

const { app, BrowserWindow, shell, nativeTheme, ipcMain, net } = require('electron');
const path = require('path');

// ---------------------------------------------------------------------------
// IPC: proxy AI HTTP requests through the main process so the renderer
// never makes outbound fetch() calls that CORS would block.
// ---------------------------------------------------------------------------
ipcMain.handle('ai-request', async (_event, { url, method, headers, body }) => {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: method || 'POST', url });
    Object.entries(headers || {}).forEach(([key, value]) => {
      request.setHeader(key, String(value));
    });

    let responseBody = '';
    let statusCode = 0;

    request.on('response', (response) => {
      statusCode = response.statusCode;
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        resolve({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, body: responseBody });
      });
      response.on('error', (err) => reject(err.message));
    });

    request.on('error', (err) => reject(err.message));
    if (body) request.write(body);
    request.end();
  });
});

const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    // Position traffic lights so they sit inside the sidebar drag region
    trafficLightPosition: { x: 16, y: 18 },
    title: 'GHCountdown',
    // Transparent background prevents white flash on launch
    // Vibrancy and transparency are macOS-only
    ...(isMac ? {
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
      visualEffectState: 'active',
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    const devUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5173';
    win.loadURL(devUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in the default browser instead of inside Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();

  // macOS: re-create window when dock icon is clicked and no windows are open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
