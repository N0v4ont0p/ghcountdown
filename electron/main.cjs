'use strict';

const { app, BrowserWindow, shell, nativeTheme, ipcMain, net, protocol, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// Register the custom 'app' scheme before the app is ready so that IndexedDB
// and other persistent-storage APIs work correctly in the renderer.  When the
// dist bundle is loaded via file:// the origin is opaque and Chromium refuses
// to open the IndexedDB backing store ("Internal error opening backing store").
// A named scheme with standard + secure privileges gives the renderer a proper
// origin (app://localhost) that Chromium accepts.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

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

// Mini panel window dimensions
const MINI_PANEL_WIDTH = 380;
const MINI_PANEL_HEIGHT = 280;
const MINI_PANEL_SCREEN_EDGE_BUFFER = 20;

// ---------------------------------------------------------------------------
// Mini panel position persistence
// ---------------------------------------------------------------------------
function getPanelPrefsPath() {
  return path.join(app.getPath('userData'), 'mini-panel-prefs.json');
}

function readPanelPrefs() {
  try {
    const raw = fs.readFileSync(getPanelPrefsPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function savePanelPrefs(prefs) {
  try {
    fs.writeFileSync(getPanelPrefsPath(), JSON.stringify(prefs), 'utf8');
  } catch {
    // Non-fatal — position just won't persist this session
  }
}

/** Returns a position object from saved prefs if it's still within a display. */
function getSavedPanelPosition() {
  const prefs = readPanelPrefs();
  if (!prefs || typeof prefs.x !== 'number' || typeof prefs.y !== 'number') return null;
  // Verify the saved position falls within the current display layout
  const displays = screen.getAllDisplays();
  const onScreen = displays.some((d) => {
    const { x, y, width, height } = d.workArea;
    return (
      prefs.x >= x &&
      prefs.x < x + width - MINI_PANEL_SCREEN_EDGE_BUFFER &&
      prefs.y >= y &&
      prefs.y < y + height - MINI_PANEL_SCREEN_EDGE_BUFFER
    );
  });
  return onScreen ? { x: prefs.x, y: prefs.y } : null;
}

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {BrowserWindow | null} */
let miniPanelWindow = null;
/** @type {object | null} */
let lastTrayStatus = null;
let appIsQuitting = false;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Notify the main window renderer that the mini panel's visible state has
 * changed.  This keeps the Settings switch in sync when the user manually
 * closes or hides the floating window.
 */
function notifyMainWindowMiniPanelState(visible) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mini-panel:state-changed', { visible });
  }
}

function showMainApp() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function toggleMiniPanel() {
  if (!miniPanelWindow || miniPanelWindow.isDestroyed()) {
    createMiniPanel();
  } else if (miniPanelWindow.isVisible()) {
    miniPanelWindow.hide();
  } else {
    miniPanelWindow.show();
    miniPanelWindow.focus();
  }
  // Rebuild menu so checkbox state reflects reality
  buildTrayMenu(lastTrayStatus);
}

function buildTrayMenu(status) {
  if (!tray || tray.isDestroyed()) return;

  const menuItems = [];

  // ---- Smart status section ----
  if (status) {
    if (status.activeBlockTitle) {
      menuItems.push({ label: `▶  ${status.activeBlockTitle}`, enabled: false });
      if (status.activeBlockRemaining) {
        menuItems.push({ label: `    ${status.activeBlockRemaining} remaining`, enabled: false });
      }
    } else if (status.nextBlockTitle) {
      menuItems.push({ label: `⏭  Next: ${status.nextBlockTitle}`, enabled: false });
      if (status.nextBlockStartsIn) {
        menuItems.push({ label: `    Starts in ${status.nextBlockStartsIn}`, enabled: false });
      }
    } else if (status.nextEventTitle) {
      menuItems.push({ label: `📅  ${status.nextEventTitle}`, enabled: false });
      if (status.nextEventCountdown) {
        menuItems.push({ label: `    In ${status.nextEventCountdown}`, enabled: false });
      }
    }

    // Current task (highest-priority today todo)
    if (status.currentTaskTitle) {
      menuItems.push({ label: `📋  ${status.currentTaskTitle}`, enabled: false });
    }

    // Today summary line
    const summaryParts = [];
    if (typeof status.unfinishedTodosCount === 'number' && status.unfinishedTodosCount > 0) {
      summaryParts.push(`${status.unfinishedTodosCount} task${status.unfinishedTodosCount !== 1 ? 's' : ''} today`);
    }
    if (typeof status.focusMinutesToday === 'number' && status.focusMinutesToday > 0) {
      const fh = Math.floor(status.focusMinutesToday / 60);
      const fm = status.focusMinutesToday % 60;
      const focusStr = fh > 0 ? `${fh}h ${fm}m focus` : `${fm}m focus`;
      summaryParts.push(focusStr);
    }
    if (summaryParts.length > 0) {
      menuItems.push({ label: `    ${summaryParts.join(' · ')}`, enabled: false });
    }

    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }
  }

  // ---- Actions ----
  menuItems.push({
    label: 'Open GHCountdown',
    click: showMainApp,
  });
  menuItems.push({
    label: 'Open Timer',
    click: () => {
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:navigate', 'timer');
      }
    },
  });
  menuItems.push({
    label: 'Quick Add',
    click: () => {
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:open-quick-capture');
      }
    },
  });
  menuItems.push({
    label: 'Search',
    click: () => {
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:open-search');
      }
    },
  });

  menuItems.push({ type: 'separator' });

  // ---- Mini panel toggle ----
  const panelVisible = miniPanelWindow && !miniPanelWindow.isDestroyed() && miniPanelWindow.isVisible();
  menuItems.push({
    label: panelVisible ? 'Hide Mini Panel' : 'Show Mini Panel',
    click: toggleMiniPanel,
  });

  menuItems.push({ type: 'separator' });

  menuItems.push({
    label: 'Quit GHCountdown',
    accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
    click: () => {
      appIsQuitting = true;
      app.quit();
    },
  });

  const contextMenu = Menu.buildFromTemplate(menuItems);
  tray.setContextMenu(contextMenu);

  // Smart title displayed next to the tray icon (keep it short)
  let title = '';
  if (status) {
    if (status.activeBlockRemaining) {
      title = status.activeBlockRemaining;
    } else if (status.nextEventCountdown) {
      title = status.nextEventCountdown;
    }
  }
  tray.setTitle(title);
}

function createMiniPanel() {
  const display = screen.getPrimaryDisplay();
  const { width: screenW } = display.workAreaSize;

  const savedPos = getSavedPanelPosition();
  const defaultX = screenW - MINI_PANEL_WIDTH - MINI_PANEL_SCREEN_EDGE_BUFFER;
  const defaultY = 60;

  miniPanelWindow = new BrowserWindow({
    width: MINI_PANEL_WIDTH,
    height: MINI_PANEL_HEIGHT,
    x: savedPos ? savedPos.x : defaultX,
    y: savedPos ? savedPos.y : defaultY,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: true,
    ...(isMac ? { vibrancy: 'sidebar', visualEffectState: 'active' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Persist position whenever the user moves the panel
  miniPanelWindow.on('moved', () => {
    if (!miniPanelWindow || miniPanelWindow.isDestroyed()) return;
    const [x, y] = miniPanelWindow.getPosition();
    savePanelPrefs({ x, y });
  });

  const miniUrl = isDev
    ? `${process.env.ELECTRON_DEV_URL || 'http://localhost:5173'}?miniPanel=1`
    : 'app://localhost/index.html?miniPanel=1';

  miniPanelWindow.loadURL(miniUrl);

  miniPanelWindow.once('ready-to-show', () => {
    if (!miniPanelWindow || miniPanelWindow.isDestroyed()) return;
    miniPanelWindow.show();
    // Forward current status so the panel doesn't wait for the next tick
    if (lastTrayStatus) {
      miniPanelWindow.webContents.send('tray:status-update', lastTrayStatus);
    }
    buildTrayMenu(lastTrayStatus);
    notifyMainWindowMiniPanelState(true);
  });

  // User manually closed the window via the OS close button — treat as disabled.
  // Notify in 'closed' (after destruction) so we emit exactly once per close.
  miniPanelWindow.on('closed', () => {
    notifyMainWindowMiniPanelState(false);
    miniPanelWindow = null;
    buildTrayMenu(lastTrayStatus);
  });

  // Window was hidden (e.g. via the hide-panel action)
  miniPanelWindow.on('hide', () => {
    notifyMainWindowMiniPanelState(false);
  });

  // Window was shown again after being hidden (e.g. via the tray toggle)
  miniPanelWindow.on('show', () => {
    notifyMainWindowMiniPanelState(true);
  });

  // Open external links in the default browser
  miniPanelWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// Minimal 16×16 black circle with transparency — used as an inline fallback
// when the icon file cannot be read.  macOS template images render the black
// portions in the appropriate menu-bar colour (light/dark adaptive).
const TRAY_ICON_FALLBACK_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAI0lEQVR4nGNgoCb4jwTxSmJV' +
  'REABNmkUJUNCAeXhQERQkw8AK997hajtbdUAAAAASUVORK5CYII=';

function createTray() {
  if (tray || !isMac) return;

  // In a packaged build the icon is placed outside the ASAR via extraResources
  // so that nativeImage.createFromPath() can always read it as a real file.
  // In development __dirname points directly to the electron/ folder.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, '../build/tray-icon.png');

  let trayIcon;
  const loaded = nativeImage.createFromPath(iconPath);
  if (!loaded.isEmpty()) {
    trayIcon = loaded.resize({ width: 16, height: 16 });
    // Mark as template so macOS renders it correctly in light/dark menu bars
    trayIcon.setTemplateImage(true);
  } else {
    // Log so it's visible in the Electron console rather than failing silently
    console.error('[tray] Failed to load icon from path, using built-in fallback:', iconPath);
    trayIcon = nativeImage.createFromDataURL(
      `data:image/png;base64,${TRAY_ICON_FALLBACK_B64}`
    );
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('GHCountdown');

  // Explicit left-click handler: pop up the context menu so the icon is
  // clearly interactive.  On macOS, setContextMenu() already configures the
  // native status-bar menu, but calling popUpContextMenu() here makes the
  // behavior deterministic and consistent across all macOS/Electron versions.
  tray.on('click', () => {
    tray.popUpContextMenu();
  });

  buildTrayMenu(null);
}

// ---------------------------------------------------------------------------
// IPC: tray status updates from renderer
// ---------------------------------------------------------------------------
ipcMain.on('tray:update-status', (_event, status) => {
  lastTrayStatus = status;
  buildTrayMenu(status);
  // Forward to mini panel if it's open
  if (miniPanelWindow && !miniPanelWindow.isDestroyed()) {
    miniPanelWindow.webContents.send('tray:status-update', status);
  }
});

// IPC: mini panel toggle from renderer settings
ipcMain.on('mini-panel:toggle', () => toggleMiniPanel());

// IPC: explicit show/hide from renderer (settings switch, auto-restore on launch)
ipcMain.on('mini-panel:set-visible', (_event, visible) => {
  if (visible) {
    if (!miniPanelWindow || miniPanelWindow.isDestroyed()) {
      createMiniPanel();
    } else if (!miniPanelWindow.isVisible()) {
      miniPanelWindow.show();
      miniPanelWindow.focus();
      buildTrayMenu(lastTrayStatus);
      notifyMainWindowMiniPanelState(true);
    }
  } else {
    if (miniPanelWindow && !miniPanelWindow.isDestroyed() && miniPanelWindow.isVisible()) {
      miniPanelWindow.hide();
      buildTrayMenu(lastTrayStatus);
      // hide event listener will call notifyMainWindowMiniPanelState(false)
    }
  }
});

// IPC: actions dispatched from the mini panel
ipcMain.on('mini-panel:action', (_event, action) => {
  switch (action) {
    case 'show-main':
      showMainApp();
      break;
    case 'navigate-timer':
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:navigate', 'timer');
      }
      break;
    case 'quick-capture':
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:open-quick-capture');
      }
      break;
    case 'search':
      showMainApp();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:open-search');
      }
      break;
    case 'hide-panel':
      if (miniPanelWindow && !miniPanelWindow.isDestroyed()) {
        miniPanelWindow.hide();
        buildTrayMenu(lastTrayStatus);
      }
      break;
    default:
      break;
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
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

  // On macOS, closing the window keeps the app alive in the menu bar.
  // The user can quit via the tray menu or Cmd+Q.
  if (isMac) {
    mainWindow.on('close', (event) => {
      if (!appIsQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
  }

  if (isDev) {
    const devUrl = process.env.ELECTRON_DEV_URL || 'http://localhost:5173';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL('app://localhost/index.html');
  }

  // Open external links in the default browser instead of inside Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // Serve the production build through the custom 'app' scheme so that the
  // renderer has a real origin and IndexedDB works correctly.
  const distRoot = path.resolve(path.join(__dirname, '../dist'));
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    const decodedPath = decodeURIComponent(pathname);
    const trimmedPath = decodedPath.replace(/^\/+/, '');
    const relativePath = trimmedPath === '' ? 'index.html' : trimmedPath;
    const hasControlChars = /[\0-\x1F\x7F-\x9F]/.test(relativePath);
    if (hasControlChars || relativePath.includes('\\')) {
      return new Response('Forbidden', { status: 403 });
    }
    const filePath = path.resolve(path.join(distRoot, relativePath));
    // Guard against directory traversal: reject any path outside dist/
    const relative = path.relative(distRoot, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString()).catch((err) => {
      const logPath = path.relative(distRoot, filePath) || '(root)';
      const message = err instanceof Error ? err.message : String(err);
      console.error('[app-protocol] failed to load:', logPath, message);
      return new Response('Not Found', { status: 404 });
    });
  });

  createWindow();
  createTray();

  // macOS: show main window when dock icon is clicked
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
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

// Ensure a clean quit (destroy tray) when the app is actually quitting
app.on('before-quit', () => {
  appIsQuitting = true;
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
});
