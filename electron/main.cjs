'use strict';

const { app, BrowserWindow, shell, nativeTheme, ipcMain, net, protocol, Tray, Menu, nativeImage, screen, globalShortcut } = require('electron');
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

// Launcher window dimensions
const LAUNCHER_WIDTH = 620;
const LAUNCHER_HEIGHT = 132;
// How far above the bottom of the active display the launcher floats.
// Far enough above the dock/taskbar that it never overlaps.
const LAUNCHER_BOTTOM_OFFSET = 140;

// Cross-platform global shortcut for the launcher.
//
// macOS: `Alt+Shift+Space` (⌥⇧Space) is the *globally registered* fallback —
//   it works even when another app is focused.  We deliberately avoid
//   `⌥⌘Space` because it sits one modifier away from Spotlight (`⌘Space`)
//   and the Spotlight character-viewer (`⌃⌘Space`), which made the old
//   binding easy to trigger by accident and confused users who expected
//   Apple's Spotlight behaviour.  `⌥⇧Space` has no default macOS binding,
//   so it's conflict-free.
//
//   The *primary* macOS trigger is double-tap ⌘ (see
//   `wireDoubleTapCommand` below), which feels native and matches the
//   muscle memory of apps like Raycast.  See the long comment on that
//   helper for the feasibility analysis and limitations.
//
// Windows / Linux: unchanged at `Control+Alt+Space`.
const LAUNCHER_SHORTCUT = isMac ? 'Alt+Shift+Space' : 'Control+Alt+Space';

// Maximum gap between the two ⌘ taps that still counts as a double-tap.
// 400 ms matches Raycast's default and feels comfortable without being so
// long that ordinary "press ⌘, then ⌘+something" flows are misread.
const DOUBLE_TAP_COMMAND_WINDOW_MS = 400;

/**
 * Attach a double-tap-⌘ detector to a `webContents` that toggles the
 * launcher when the user taps the Command key twice in quick succession
 * with no other key pressed in between.
 *
 * Feasibility note (macOS double-tap ⌘):
 *   A *truly global* double-tap-⌘ trigger (one that fires while another
 *   app like Finder or Safari is focused) requires a native macOS
 *   `CGEventTap` — i.e. a Swift helper or a native node module such as
 *   `uiohook-napi`.  Both paths require Accessibility permission, a
 *   per-Electron-version native rebuild, and additional signing /
 *   notarization work.  None of that is reliable enough to ship as part
 *   of this change.
 *
 *   Electron's built-in `globalShortcut` API also can't help: it only
 *   accepts modifier+key Accelerator strings and never fires for a
 *   modifier-only press.
 *
 *   What *is* reliable today, with no permissions and no native code,
 *   is detecting double-tap ⌘ from `webContents.on('before-input-event')`
 *   while one of our app's windows is focused.  Combined with the
 *   `⌥⇧Space` global accelerator (which handles the unfocused case),
 *   this delivers the requested double-tap-⌘ UX whenever the user is
 *   actually interacting with our app, and never collides with Finder
 *   or Spotlight.
 */
function wireDoubleTapCommand(webContents) {
  if (!isMac || !webContents || webContents.isDestroyed()) return;

  // Per-webContents state: the timestamp of the most recent qualifying
  // ⌘ keyUp, whether ⌘ is currently held down, and whether the current
  // ⌘ press has already been "consumed" by being chorded with another
  // key (e.g. ⌘C, ⌘V) — chorded presses must NOT count as a tap.
  let lastTapAt = 0;
  let metaDown = false;
  let metaChorded = false;

  webContents.on('before-input-event', (_event, input) => {
    // We only care about real key events.
    if (input.type !== 'keyDown' && input.type !== 'keyUp') return;

    const isMetaKey = input.key === 'Meta' || input.code === 'MetaLeft' || input.code === 'MetaRight';

    if (isMetaKey) {
      if (input.type === 'keyDown') {
        // Ignore auto-repeat keyDowns from holding ⌘.
        if (!metaDown) {
          metaDown = true;
          metaChorded = false;
        }
        return;
      }

      // keyUp on ⌘.  Only counts as a tap if ⌘ wasn't chorded with
      // another key while held.
      metaDown = false;
      if (metaChorded) {
        metaChorded = false;
        lastTapAt = 0;
        return;
      }

      const now = Date.now();
      if (lastTapAt && now - lastTapAt <= DOUBLE_TAP_COMMAND_WINDOW_MS) {
        lastTapAt = 0;
        // Defer to the next tick so this handler returns before the
        // launcher window steals focus from the source webContents.
        setImmediate(() => toggleLauncher());
      } else {
        lastTapAt = now;
      }
      return;
    }

    // Any non-meta key: if ⌘ is currently held, this press is a chord
    // (⌘+letter, ⌘+arrow, etc.) and the ⌘ release must not count as a
    // tap.  Also reset the double-tap timer on any other keystroke so
    // sequences like "⌘, x, ⌘" don't accidentally fire the launcher.
    if (input.type === 'keyDown') {
      if (metaDown) metaChorded = true;
      lastTapAt = 0;
    }
  });
}

/**
 * Render the global shortcut as a human-readable label for menus.
 * Single source of truth: keeps the tray menu, future tooltips, and the
 * registration call from drifting apart.
 */
function formatShortcutLabel(accelerator) {
  if (isMac) {
    return accelerator
      .replace(/CommandOrControl|Cmd|Command/g, '⌘')
      .replace(/Alt|Option/g, '⌥')
      .replace(/Shift/g, '⇧')
      .replace(/Ctrl|Control/g, '⌃')
      .replace(/\+/g, '');
  }
  return accelerator;
}

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
/** @type {BrowserWindow | null} */
let launcherWindow = null;
/**
 * True once the launcher window has fired `ready-to-show` AND its webContents
 * have finished loading.  Used to gate show/focus/IPC calls so rapid-fire
 * shortcut presses (or a tray click during initial load) don't operate on a
 * half-initialized window.
 */
let launcherReady = false;
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

/**
 * On macOS, un-hide the application at the OS level and steal focus so that
 * the app surfaces properly after being hidden via mainWindow.hide().
 * app.show() reverses the "hidden" state; app.focus({ steal: true }) makes the
 * app the active/frontmost application even when another app holds focus.
 * This is a no-op on other platforms.
 */
function activateMacOSApp() {
  if (isMac) {
    app.show();
    app.focus({ steal: true });
  }
}

function showMainApp() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    activateMacOSApp();
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
    label: isMac
      ? `Open Launcher\t⌘⌘ or ${formatShortcutLabel(LAUNCHER_SHORTCUT)}`
      : `Open Launcher\t${formatShortcutLabel(LAUNCHER_SHORTCUT)}`,
    click: () => showLauncher(),
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

  // Smart title displayed next to the tray icon (keep it short).
  // Priority: active block > next block start > next event.
  // A brief symbol prefix makes each state visually distinct at a glance.
  let title = '';
  if (status) {
    if (status.activeBlockRemaining) {
      title = `▶ ${status.activeBlockRemaining}`;
    } else if (status.nextBlockStartsIn) {
      title = `⏭ ${status.nextBlockStartsIn}`;
    } else if (status.nextEventCountdown) {
      title = `📅 ${status.nextEventCountdown}`;
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

// ---------------------------------------------------------------------------
// Global launcher window
// ---------------------------------------------------------------------------

/**
 * Compute the on-screen position for the launcher: horizontally centered on
 * the display containing the cursor, anchored above the bottom edge.
 */
function getLauncherPosition() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const { x, y, width, height } = display.workArea;
  const px = Math.round(x + (width - LAUNCHER_WIDTH) / 2);
  const py = Math.round(y + height - LAUNCHER_HEIGHT - LAUNCHER_BOTTOM_OFFSET);
  return { x: px, y: py };
}

function createLauncherWindow() {
  if (launcherWindow && !launcherWindow.isDestroyed()) return launcherWindow;

  // Reset readiness — we'll flip this to true once the page is fully loaded.
  launcherReady = false;

  const { x, y } = getLauncherPosition();

  launcherWindow = new BrowserWindow({
    width: LAUNCHER_WIDTH,
    height: LAUNCHER_HEIGHT,
    x,
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    // Don't show in the macOS App Switcher (Cmd+Tab) — this is a utility popup,
    // not a regular window.
    ...(isMac ? { type: 'panel' } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Float above full-screen apps too — important for a global launcher.
  launcherWindow.setAlwaysOnTop(true, 'screen-saver');
  if (isMac) {
    launcherWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const launcherUrl = isDev
    ? `${process.env.ELECTRON_DEV_URL || 'http://localhost:5173'}?launcher=1`
    : 'app://localhost/index.html?launcher=1';
  // Surface load failures specifically rather than letting them silently
  // strand the launcher in an invisible-but-existing state.  The fail handler
  // below will tear down the broken window so the next press recreates it.
  launcherWindow.loadURL(launcherUrl).catch((err) => {
    console.error(`[launcher] loadURL('${launcherUrl}') rejected:`, err);
  });

  // Mark the window ready only after the renderer has actually finished
  // loading.  ready-to-show alone is not enough: webContents.send() before
  // the renderer has subscribed to 'launcher:shown' silently drops the event.
  launcherWindow.webContents.once('did-finish-load', () => {
    launcherReady = true;
  });

  // If the page fails to load (broken bundle, dev server down, app:// error),
  // log the *specific* failure and destroy the window so the next show recreates
  // it from scratch instead of silently doing nothing.
  launcherWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(
      `[launcher] did-fail-load (${errorCode} ${errorDescription}) for ${validatedURL}`
    );
    launcherReady = false;
    if (launcherWindow && !launcherWindow.isDestroyed()) {
      launcherWindow.destroy();
    }
  });

  // Hide instead of close when focus is lost so the popup feels lightweight.
  launcherWindow.on('blur', () => {
    if (!launcherWindow || launcherWindow.isDestroyed()) return;
    // Don't auto-hide before the page has even finished loading: a transient
    // blur during startup would otherwise leave the launcher invisible and
    // make the very first shortcut press feel like it "failed".
    if (!launcherReady) return;
    if (launcherWindow.isVisible()) launcherWindow.hide();
  });

  launcherWindow.on('closed', () => {
    launcherWindow = null;
    launcherReady = false;
  });

  // Open external links in the default browser
  launcherWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return launcherWindow;
}

/**
 * Internal: actually present the launcher window.  Assumes `launcherWindow`
 * exists and is not destroyed.  Safe to call repeatedly; gates the
 * 'launcher:shown' IPC on the renderer being loaded so the message is never
 * dropped on the floor.
 */
function presentLauncher() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return;

  try {
    const pos = getLauncherPosition();
    launcherWindow.setPosition(pos.x, pos.y);
  } catch (err) {
    console.error('[launcher] setPosition failed:', err);
  }

  // On macOS, the launcher is a `type: 'panel'` window which doesn't activate
  // the app on its own.  If another app currently holds focus, calling
  // `.focus()` on the BrowserWindow alone may not steal it — the launcher
  // would then receive an immediate blur and hide itself, looking "broken".
  // Promoting the app to frontmost first makes focus reliable.
  if (isMac) {
    try { app.focus({ steal: true }); } catch (err) {
      console.error('[launcher] app.focus failed:', err);
    }
  }

  try {
    launcherWindow.show();
    launcherWindow.focus();
    if (typeof launcherWindow.moveTop === 'function') launcherWindow.moveTop();
  } catch (err) {
    console.error('[launcher] show/focus failed:', err);
  }

  // Notify the renderer to refocus the input + clear stale flash, but only
  // once it has actually subscribed.  Otherwise the message is silently lost
  // and the input doesn't get focus on the very first show.
  notifyLauncherShown();
}

/**
 * Send 'launcher:shown' to the renderer, deferring until the page is loaded.
 */
function notifyLauncherShown() {
  if (!launcherWindow || launcherWindow.isDestroyed()) return;
  const wc = launcherWindow.webContents;
  if (launcherReady && !wc.isLoading()) {
    try { wc.send('launcher:shown'); } catch (err) {
      console.error('[launcher] send(launcher:shown) failed:', err);
    }
    return;
  }
  // Page not ready yet — wait for it, then fire exactly once.
  wc.once('did-finish-load', () => {
    if (!launcherWindow || launcherWindow.isDestroyed()) return;
    try { launcherWindow.webContents.send('launcher:shown'); } catch (err) {
      console.error('[launcher] deferred send(launcher:shown) failed:', err);
    }
  });
}

/**
 * Show the launcher: create on first use, otherwise re-position to the active
 * display, show, and focus.  Sends 'launcher:shown' so the renderer can clear
 * any stale flash messages and re-focus the input.
 */
function showLauncher() {
  if (!launcherWindow || launcherWindow.isDestroyed()) {
    createLauncherWindow();
    // Wait for the page to be ready before showing — avoids a flash of blank.
    // Using `once` on the BrowserWindow event is fine because createLauncherWindow
    // creates a fresh window (and a fresh listener) every time.
    launcherWindow.once('ready-to-show', () => {
      presentLauncher();
    });
    return;
  }

  // Existing window: just present it.  presentLauncher() is safe whether or
  // not the page has finished loading (it queues the 'launcher:shown' IPC).
  presentLauncher();
}

function hideLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
    try { launcherWindow.hide(); } catch (err) {
      console.error('[launcher] hide failed:', err);
    }
  }
}

function toggleLauncher() {
  if (launcherWindow && !launcherWindow.isDestroyed() && launcherWindow.isVisible()) {
    // Already visible: just refocus the input (gives the user a clean slate).
    try {
      if (isMac) app.focus({ steal: true });
      launcherWindow.focus();
    } catch (err) {
      console.error('[launcher] toggle focus failed:', err);
    }
    notifyLauncherShown();
    return;
  }
  showLauncher();
}

ipcMain.on('launcher:hide', () => hideLauncher());

/**
 * Cross-window data change broadcast.
 *
 * The launcher is a separate BrowserWindow with its own renderer, so a
 * `window.dispatchEvent('ghc-data-changed')` fired inside the launcher is
 * never seen by the main app.  Without this hop, todos/notes created from
 * the launcher land in IndexedDB but the main app's lists don't refresh
 * until the user manually reloads, making the launcher feel like it
 * "didn't actually save".
 *
 * Any renderer can fire `'data:changed'`; the main process re-broadcasts
 * it to every window so they can re-fetch from IndexedDB.
 */
ipcMain.on('data:changed', (event, payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    // Skip the sender — it already updated its own UI via the local
    // 'ghc-data-changed' event before sending the IPC.
    if (event.sender && win.webContents.id === event.sender.id) continue;
    try {
      win.webContents.send('data:changed', payload);
    } catch (err) {
      console.error('[data:changed] forward to window failed:', err);
    }
  }
});

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

// Minimal 16×16 black circle with transparency — used as an inline fallback
// when the icon file cannot be read.  macOS template images render the black
// portions in the appropriate menu-bar colour (light/dark adaptive).
const TRAY_ICON_FALLBACK_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAI0lEQVR4nGNgoCb4jwTxSmJV' +
  'REABNmkUJUNCAeXhQERQkw8AK997hajtbdUAAAAASUVORK5CYII=';

function createTray() {
  if (tray) return;

  // The tray icon is platform-agnostic: macOS uses it as a menu-bar template,
  // Windows uses it for the system tray.  Either way, the same PNG works.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(__dirname, '../build/tray-icon.png');

  let trayIcon;
  const loaded = nativeImage.createFromPath(iconPath);
  if (!loaded.isEmpty()) {
    trayIcon = loaded.resize({ width: 16, height: 16 });
    // macOS only: render as a template so the menu-bar tints it light/dark.
    if (isMac) trayIcon.setTemplateImage(true);
  } else {
    // Log so it's visible in the Electron console rather than failing silently
    console.error('[tray] Failed to load icon from path, using built-in fallback:', iconPath);
    trayIcon = nativeImage.createFromDataURL(
      `data:image/png;base64,${TRAY_ICON_FALLBACK_B64}`
    );
    if (isMac) trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('GHCountdown');

  // Explicit left-click handler: pop up the context menu so the icon is
  // clearly interactive.  On macOS, setContextMenu() already configures the
  // native status-bar menu, but calling popUpContextMenu() here makes the
  // behavior deterministic and consistent across all macOS/Electron versions.
  // On Windows, left-click typically activates the app, so we open the main
  // window instead and reserve the right-click for the menu.
  if (isMac) {
    tray.on('click', () => {
      tray.popUpContextMenu();
    });
  } else {
    tray.on('click', () => {
      showMainApp();
    });
  }

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

  // Closing the main window keeps the app alive in the menu bar (macOS) /
  // system tray (Windows) so the global shortcut continues to work.  The user
  // can fully quit via the tray menu or Cmd+Q / Ctrl+Q.
  mainWindow.on('close', (event) => {
    if (!appIsQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

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
  // macOS: install the double-tap-⌘ launcher trigger on every webContents
  // we create.  Registered before the first window so the main window picks
  // it up via `web-contents-created`.
  if (isMac) {
    app.on('web-contents-created', (_event, contents) => {
      wireDoubleTapCommand(contents);
    });
  }

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

  // Register the global launcher shortcut.  On macOS the *primary* trigger
  // is double-tap-⌘ (wired above via `web-contents-created`); this
  // accelerator is the unfocused-app fallback.  We try the platform-default
  // first and, if the OS rejects it (e.g. another app already grabbed the
  // combination), log a warning rather than crash.
  const registered = globalShortcut.register(LAUNCHER_SHORTCUT, () => {
    toggleLauncher();
  });
  if (!registered) {
    console.warn(`[launcher] Failed to register global shortcut '${LAUNCHER_SHORTCUT}' — it may be in use by another app.`);
  }

  // macOS: show main window when dock icon is clicked
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      activateMacOSApp();
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// The app must keep running even when every window is closed so the global
// shortcut and tray menu stay live (matches Claude / ChatGPT desktop behaviour).
// The user explicitly quits via the tray menu or Cmd+Q / Ctrl+Q.
app.on('window-all-closed', () => {
  // Intentionally a no-op on every platform.
});

// Ensure a clean quit (destroy tray, release global shortcuts) when the app
// is actually quitting.
app.on('before-quit', () => {
  appIsQuitting = true;
  try { globalShortcut.unregisterAll(); } catch { /* best-effort */ }
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
});

app.on('will-quit', () => {
  try { globalShortcut.unregisterAll(); } catch { /* best-effort */ }
});
