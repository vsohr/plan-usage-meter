'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');

const { getCodexUsage, fetchClaudeUsage } = require('./usage');
const {
  CH,
  AUTO_POLL_INTERVAL_MS,
  PROVIDER_USAGE_CACHE_MS,
  runWithTimeout,
  buildAccountUsagePayload,
  buildUnavailableProvider,
  buildRateLimitedProvider,
  isProviderCacheFresh,
  isProviderHttp429,
  clampToDisplay,
  selectDefaultDisplay,
  pinnedResizeBounds,
  modeResizeBounds,
  normalizeWindowMode,
  widthForMode,
  defaultHeightForMode,
  readJsonSafe,
  writeJsonAtomic,
  buildTooltip,
  backfillClaudePrimaryReset,
  resolveClaudeCredentialsPath,
  ensureFreshClaudeCredentials
} = require('./main-lib');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const APP_ICON_PATH = path.join(ASSETS_DIR, process.platform === 'win32' ? 'icon.ico' : 'app-icon.png');
const TRAY_ICON_PATH = path.join(ASSETS_DIR, 'tray.png');

// Linux display / app-id / sandbox tuning (no-ops on Windows/macOS).
if (process.platform === 'linux') {
  // Prefer the session's native display backend. On a Wayland session this is
  // KWin/Wayland, where Chromium's surface is composited directly and reliably.
  // XWayland on NVIDIA is broken for this window every way tried: native GL
  // segfaults the GPU process in a loop, and software/ANGLE paths never get a
  // real top-level X11 window (handle resolves to 0x1) so KWin never shows it.
  // On an X11 session this hint resolves to X11, where the app's own positioning
  // and always-on-top work natively.
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  // Pin a stable Wayland app-id / X11 WM_CLASS ("plan-usage-meter") regardless of
  // the display name, so the KWin window rule and the .desktop StartupWMClass
  // match this window reliably (KWin uses app-id to apply rules + resolve icons).
  app.commandLine.appendSwitch('class', 'plan-usage-meter');
  // chrome-sandbox isn't setuid-root here and we can't elevate unattended; the
  // unprivileged user-namespace sandbox stays active.
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}

const CLAUDE_CREDENTIALS_PATH = resolveClaudeCredentialsPath();

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err)    => console.error('[uncaughtException]', err));

let win = null;
let pollInFlight = false;
let pollTimer = null;
let initialPollTimer = null;
let latestUsage = null;
let resizeTimer = null;
let claudeRateLimitedUntil = 0;
let codexUsageCache = null;
let claudeUsageCache = null;
let currentMode = 'expanded';

const CLAUDE_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;

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
    writeJsonAtomic(windowStatePath, {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      mode: currentMode
    });
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

function defaultBottomRight(work, mode = 'expanded') {
  const margin = 16;
  const width = widthForMode(mode);
  const height = defaultHeightForMode(mode);
  return {
    x: work.x + work.width - width - margin,
    y: work.y + work.height - height - margin,
    width,
    height
  };
}

function createWindow() {
  const defaultDisplay = selectDefaultDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay());
  const work = defaultDisplay.workArea;
  const saved = loadWindowState();
  currentMode = normalizeWindowMode(saved && saved.mode);
  const width = widthForMode(currentMode);
  let bounds = null;
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    const display = screen.getDisplayMatching({
      x: saved.x,
      y: saved.y,
      width,
      height: saved.height || defaultHeightForMode(currentMode)
    });
    bounds = clampToDisplay(saved, display, width, defaultHeightForMode(currentMode));
  }
  if (!bounds) bounds = defaultBottomRight(work, currentMode);

  win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    icon: APP_ICON_PATH,
    frame: false,
    // On Linux/NVIDIA under XWayland, a transparent + software-rendered surface
    // paints (capturePage sees it) but is never composited on screen — it maps as
    // an unmanaged override-redirect window KWin won't show. An opaque window is
    // WM-managed and composites normally. The solid backing matches --bg, so the
    // only visible change is that the rounded corners are no longer see-through.
    transparent: process.platform !== 'linux',
    backgroundColor: process.platform === 'linux' ? '#141418' : undefined,
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
    win.webContents.send(CH.WIN_MODE, currentMode);
    if (latestUsage) win.webContents.send(CH.USAGE_UPDATE, latestUsage);
    scheduleInitialPoll();
  });
  win.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    win.hide();
    rebuildTrayMenu();
  });
  win.on('show', rebuildTrayMenu);
  win.on('hide', rebuildTrayMenu);
  win.on('moved',   scheduleWindowStateSave);
  win.on('resized', scheduleWindowStateSave);
}

let tray = null;

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) return;
    t = setTimeout(() => { t = null; }, ms);
    fn(...args);
  };
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function setWindowMode(rawMode) {
  if (!win || win.isDestroyed()) return;
  const next = normalizeWindowMode(rawMode);
  if (next === currentMode) return;
  currentMode = next;
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
  const cur = win.getBounds();
  const target = modeResizeBounds(cur, currentMode);
  if (target) win.setBounds(target, false);
  win.webContents.send(CH.WIN_MODE, currentMode);
  scheduleWindowStateSave();
  rebuildTrayMenu();
}

function setOpenAtLogin(value) {
  const desired = !!value;
  try {
    app.setLoginItemSettings({
      openAtLogin: desired,
      openAsHidden: true,
      args: desired ? ['--hidden'] : []
    });
    settings.openAtLogin = desired;
  } catch (err) {
    console.warn('[setOpenAtLogin] failed:', err.message);
  }
  saveSettings();
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const visible = !!(win && win.isVisible());
  const minimal = currentMode === 'minimal';
  const template = [
    { label: visible ? 'Hide' : 'Show', click: toggleWindow },
    { label: 'Refresh now', click: () => poll() },
    {
      label: minimal ? 'Restore' : 'Minimise',
      click: () => setWindowMode(minimal ? 'expanded' : 'minimal')
    },
    { type: 'separator' },
    {
      label: 'Open at login',
      type: 'checkbox',
      checked: !!settings.openAtLogin,
      click: (item) => setOpenAtLogin(item.checked)
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  let image;
  try {
    image = nativeImage.createFromPath(TRAY_ICON_PATH);
    if (image.isEmpty()) throw new Error('tray.png decoded to empty image');
  } catch (err) {
    console.warn('[tray] failed to load icon:', err.message);
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('Plan Usage');
  tray.on('click', debounce(toggleWindow, 250));
  rebuildTrayMenu();
}

function broadcastUsage(usage) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(CH.USAGE_UPDATE, usage);
  }
}

async function getCodexProvider(nowMs) {
  if (isProviderCacheFresh(codexUsageCache, PROVIDER_USAGE_CACHE_MS, nowMs)) {
    return { provider: codexUsageCache.provider };
  }
  try {
    const provider = await getCodexUsage();
    if (provider?.available) codexUsageCache = { provider, savedAtMs: Date.now() };
    return { provider };
  } catch (err) {
    return {
      provider: buildUnavailableProvider('codex', err.message || 'Codex usage unavailable'),
      error: err.message
    };
  }
}

async function preflightClaudeRefresh({ force = false } = {}) {
  try {
    return await ensureFreshClaudeCredentials(CLAUDE_CREDENTIALS_PATH, { force });
  } catch (err) {
    console.warn('[claude] token refresh failed:', err.message);
    return { refreshed: false, error: err.message };
  }
}

async function getClaudeProvider(nowMs) {
  if (claudeRateLimitedUntil > nowMs) {
    return {
      provider: buildRateLimitedProvider('claude', claudeRateLimitedUntil, nowMs),
      error: `HTTP 429 (rate limited until ${new Date(claudeRateLimitedUntil).toISOString()})`
    };
  }
  if (isProviderCacheFresh(claudeUsageCache, PROVIDER_USAGE_CACHE_MS, nowMs)) {
    return { provider: claudeUsageCache.provider };
  }

  await preflightClaudeRefresh();

  try {
    const provider = backfillClaudePrimaryReset(await fetchClaudeUsage());
    if (provider?.available) {
      claudeUsageCache = { provider, savedAtMs: Date.now() };
      claudeRateLimitedUntil = 0;
    }
    return { provider };
  } catch (err) {
    if (/HTTP\s*401\b/i.test(err.message || '')) {
      const refresh = await preflightClaudeRefresh({ force: true });
      if (refresh.refreshed) {
        try {
          const provider = backfillClaudePrimaryReset(await fetchClaudeUsage());
          if (provider?.available) {
            claudeUsageCache = { provider, savedAtMs: Date.now() };
            claudeRateLimitedUntil = 0;
          }
          return { provider };
        } catch (retryErr) {
          err = retryErr;
        }
      }
    }
    let provider = buildUnavailableProvider('claude', err.message || 'Claude usage unavailable');
    let error = err.message;
    const providers = { claude: provider };
    const errors = { claude: error };
    if (isProviderHttp429({ providers, errors }, 'claude')) {
      claudeRateLimitedUntil = Date.now() + CLAUDE_RATE_LIMIT_BACKOFF_MS;
      provider = buildRateLimitedProvider('claude', claudeRateLimitedUntil);
      error = `HTTP 429 (rate limited until ${new Date(claudeRateLimitedUntil).toISOString()})`;
    }
    return { provider, error };
  }
}

async function getUsageWithProviderCaching() {
  const nowMs = Date.now();
  const codex = await getCodexProvider(nowMs);
  const claude = await getClaudeProvider(nowMs);
  const providers = { codex: codex.provider, claude: claude.provider };
  const errors = {};
  if (codex.error) errors.codex = codex.error;
  if (claude.error) errors.claude = claude.error;
  return buildAccountUsagePayload({ providers, errors });
}

function withRefreshTimes(usage, nowMs = Date.now()) {
  return {
    ...usage,
    nextRefreshAt: new Date(nowMs + AUTO_POLL_INTERVAL_MS).toISOString()
  };
}

async function poll() {
  if (pollInFlight) return;
  if (app.isQuitting) return;
  pollInFlight = true;
  try {
    const usage = withRefreshTimes(await runWithTimeout(getUsageWithProviderCaching, 15_000));
    if (app.isQuitting) return;
    latestUsage = usage;
    broadcastUsage(usage);
    if (tray && !tray.isDestroyed()) {
      tray.setToolTip(buildTooltip(usage));
      rebuildTrayMenu();
    }
  } catch (err) {
    console.error('[poll] unexpected', err);
  } finally {
    pollInFlight = false;
  }
}

function scheduleInitialPoll() {
  if (initialPollTimer) return;
  initialPollTimer = setTimeout(() => {
    initialPollTimer = null;
    poll();
  }, 100);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();
  try {
    app.setLoginItemSettings({
      openAtLogin: !!settings.openAtLogin,
      openAsHidden: true,
      args: settings.openAtLogin ? ['--hidden'] : []
    });
  } catch (err) {
    console.warn('[setLoginItemSettings] init failed:', err.message);
  }

  ipcMain.handle(CH.USAGE_REFRESH, () => {
    if (pollInFlight) return { accepted: false };
    poll();
    return { accepted: true };
  });
  ipcMain.on(CH.WIN_HIDE,  () => { if (win) win.hide(); });
  ipcMain.on(CH.APP_QUIT,  () => { app.isQuitting = true; app.quit(); });
  ipcMain.on(CH.WIN_MODE_SET, (_e, mode) => setWindowMode(mode));
  ipcMain.on(CH.WIN_HEIGHT, (_e, raw) => {
    const px = Math.max(80, Math.min(1200, Math.round(Number(raw) || 0)));
    if (resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      if (!win || win.isDestroyed()) return;
      const cur = win.getBounds();
      const next = pinnedResizeBounds(cur, px);
      if (next) win.setBounds(next, false);
    }, 16);
  });

  pollTimer = setInterval(poll, AUTO_POLL_INTERVAL_MS);
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (initialPollTimer) { clearTimeout(initialPollTimer); initialPollTimer = null; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (saveStateTimer) { clearTimeout(saveStateTimer); saveStateTimer = null; }
  saveWindowState();
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null; }
});

app.on('window-all-closed', () => {
  // Tray-only presence: never quit on window close.
  // Process exits only via the tray "Quit" menu (sets app.isQuitting and calls app.quit()).
});
