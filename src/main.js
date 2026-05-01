'use strict';

const path = require('path');
const { app, BrowserWindow, screen } = require('electron');

const { getAccountUsage } = require('./usage');

// --- Single-instance lock (AC10) ---
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// --- Last-resort error backstops (AC23) ---
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

let win = null;

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
  const bounds = defaultBottomRight(work);
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
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(async () => {
  createWindow();
  // M1 sanity poll — proves the detection bridge works end-to-end.
  // M2 replaces this with the timer + IPC broadcast.
  try {
    const usage = await getAccountUsage();
    console.log('[poll:M1] %s', JSON.stringify({
      available: usage.available,
      providers: Object.keys(usage.providers || {}),
      label: usage.label
    }));
  } catch (err) {
    console.error('[poll:M1] failed', err);
  }
});

app.on('window-all-closed', () => {
  // Tray takes over in M4 — for M1, quitting on last-window-close is fine.
  app.quit();
});
