'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const { getAccountUsage } = require('./usage');
const {
  CH,
  runWithTimeout,
  clampToDisplay,
  readJsonSafe,
  writeJsonAtomic,
  buildTooltip
} = require('./main-lib');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err)    => console.error('[uncaughtException]', err));

let win = null;
let pollInFlight = false;
let pollTimer = null;
let latestUsage = null;
let resizeTimer = null;

let settings = { openAtLogin: false };
let settingsPath = null;
let windowStatePath = null;
let saveStateTimer = null;

function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  settings = readJsonSafe(settingsPath, { openAtLogin: false });
}

function saveSettings() {
  if (!settingsPath) return;
  try {
    writeJsonAtomic(settingsPath, settings);
  } catch (err) {
    console.warn('[settings] save failed:', err.message);
  }
}

function loadWindowState() {
  windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  return readJsonSafe(windowStatePath, null);
}

function saveWindowState() {
  if (!win || win.isDestroyed() || !windowStatePath) return;
  if (!win.isVisible()) return;
  try {
    const b = win.getBounds();
    writeJsonAtomic(windowStatePath, { x: b.x, y: b.y, width: 340, height: b.height });
  } catch (err) {
    console.warn('[window-state] save failed:', err.message);
  }
}

function scheduleWindowStateSave() {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    saveWindowState();
  }, 500);
}

function defaultBottomRight(work) {
  const margin = 16;
  const width = 340;
  const height = 180;
  return {
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    width,
    height
  };
}

function createWindow() {
  const work = screen.getPrimaryDisplay().workArea;
  const saved = loadWindowState();
  let bounds = null;
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const display = screen.getDisplayMatching({
      x: saved.x,
      y: saved.y,
      width: 340,
      height: saved.height || 200
    });
    bounds = clampToDisplay(saved, display);
  }
  if (!bounds) bounds = defaultBottomRight(work);

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.env.PUM_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
    if (latestUsage) win.webContents.send(CH.USAGE_UPDATE, latestUsage);
  });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('moved',   scheduleWindowStateSave);
  win.on('resized', scheduleWindowStateSave);
}

function broadcastUsage(usage) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(CH.USAGE_UPDATE, usage);
  }
}

async function poll() {
  if (pollInFlight) return;
  if (app.isQuitting) return;
  pollInFlight = true;
  try {
    const usage = await runWithTimeout(getAccountUsage, 15_000);
    latestUsage = usage;
    broadcastUsage(usage);
    // M4 adds: rebuildTrayMenu(); tray.setToolTip(buildTooltip(usage));
  } catch (err) {
    console.error('[poll] unexpected', err);
  } finally {
    pollInFlight = false;
  }
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle(CH.USAGE_REFRESH, () => {
    if (pollInFlight) return { accepted: false };
    poll();
    return { accepted: true };
  });
  ipcMain.on(CH.WIN_HIDE,  () => { if (win) win.hide(); });
  ipcMain.on(CH.APP_QUIT,  () => { app.isQuitting = true; app.quit(); });
  ipcMain.on(CH.WIN_HEIGHT, (_e, raw) => {
    const px = Math.max(80, Math.min(1200, Math.round(Number(raw) || 0)));
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!win || win.isDestroyed()) return;
      const cur = win.getBounds();
      const newY = cur.y + (cur.height - px);
      win.setBounds({ x: cur.x, y: newY, width: 340, height: px }, false);
    }, 16);
  });

  poll();
  pollTimer = setInterval(poll, 60_000);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveWindowState();
});

app.on('window-all-closed', () => {
  // Tray takes over in M4. For M2, hide-not-quit is wired via win.on('close').
});
