/*
 * The surface host. Runs Agent Brief's main process and renderer in a terminal pane on Pixel's Electron.
 *
 * It replaces Pixel's bootstrap because Pixel loads an app after ready, and the app registers
 * its privileged scheme and userData before ready. A shim on require('electron') hands the
 * window behind Pixel's WebView to the app's Panel in place of a new BrowserWindow.
 */

const Module = require('node:module');
const path = require('node:path');

const realElectron = require('electron');
const { guardCellZoom, startAtActualSize } = require('./zoom-guard.cjs');
const { holdStill, reduceMotion, settleHover } = require('./still.cjs');
const { app } = realElectron;

// An uncaught error must not raise Electron's dialog in a headless pane.
const fatal = (where, error) => {
  process.stderr.write(`surface ${where}: ${error instanceof Error ? error.stack : error}\n`);
  app.exit(1);
};
process.on('uncaughtException', (error) => fatal('uncaught', error));
process.on('unhandledRejection', (reason) => process.stderr.write(`surface unhandled rejection: ${reason instanceof Error ? reason.stack : reason}\n`));

if (!process.env.COMPANION_DATA_DIR || !process.env.COMPANION_SOCKET) fatal('env', 'COMPANION_DATA_DIR and COMPANION_SOCKET are required');

const appDir = path.join(__dirname, 'app');
const mainBundle = path.join(appDir, 'out/main/index.cjs');

// Pixel's binary is not named electron, so Electron would report a packaged app and start the updater and installers.
Object.defineProperty(app, 'isPackaged', { get: () => false });

// Pixel's bootstrap sets these for offscreen rendering.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-features', 'FedCm');

guardCellZoom(require(path.join(__dirname, 'node_modules/@zenbu-labs/pixel/dist/scale.js')).CellZoomFollower);

const audioOnly = (kinds) => kinds.every((kind) => kind === 'audio');

/*
 * Pixel emulates focus on the top page only. A review page runs in a cross-process frame, which
 * Chromium then treats as inactive and paints no caret, so each focus change is repeated to those frames.
 * Every page is also told that the person prefers reduced motion.
 */
function emulateInFrames(contents) {
  const FOCUS = 'Emulation.setFocusEmulationEnabled';
  const MEDIA = 'Emulation.setEmulatedMedia';
  const cdp = contents.debugger;
  const send = cdp.sendCommand.bind(cdp);
  const frames = new Set();
  let focused = false;
  let watching = false;
  const apply = (session) => send(FOCUS, { enabled: focused }, session).catch(() => {});

  cdp.on('message', (_event, method, params) => {
    if (method === 'Target.attachedToTarget' && params.targetInfo.type === 'iframe') {
      frames.add(params.sessionId);
      apply(params.sessionId);
      send(MEDIA, reduceMotion(), params.sessionId).catch(() => {});
    } else if (method === 'Target.detachedFromTarget') {
      frames.delete(params.sessionId);
    }
  });
  cdp.sendCommand = (method, params, session) => {
    const sent = send(method, method === MEDIA && !session ? reduceMotion(params) : params, session);
    if (method === FOCUS && !session) {
      focused = params.enabled;
      frames.forEach(apply);
      if (!watching) {
        watching = true;
        send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
      }
    }
    return sent;
  };
}

function adoptPanelWindow(options) {
  const { createRoot } = require('@zenbu-labs/pixel');
  settleHover(require(path.join(__dirname, 'node_modules/@zenbu-labs/pixel/dist/web/input.js')).PageInput);
  const root = createRoot({
    name: 'Agent Brief',
    devtools: false,
    onKey(event) {
      if (event.kind !== 'press') return false;
      if (event.mods.ctrl && event.key === 'q') {
        app.quit();
        return true;
      }

      // Taken here so it works with focus inside a review page's frame.
      if (event.mods.super && event.key === 'enter') {
        globalThis.__surfaceDone?.();
        return true;
      }
      return false;
    },
    onExit: (code) => app.exit(code),
  });

  // Panel loads the real page itself, so the WebView starts blank.
  const handle = root.loadURL('about:blank', {
    preload: options.webPreferences.preload,

    // Pixel defaults this to true, which would expose the preload's IPC to review frames.
    browserWindowOptions: { webPreferences: { nodeIntegrationInSubFrames: false }, backgroundColor: options.backgroundColor },
    devtools: false,

    // The app's own page may use the microphone. Pixel answers its safe built-ins before this runs.
    onPermissionCheck: (check) => check.permission === 'media' && check.origin === check.embedder && audioOnly(check.mediaTypes),
    onPermissionRequest: async (request) => request.permission === 'media' && request.origin === request.embedder && request.mediaTypes.length > 0 && audioOnly(request.mediaTypes),
  });
  startAtActualSize(handle.webContents);
  emulateInFrames(handle.webContents);
  holdStill(handle.webContents);
  const win = realElectron.BrowserWindow.fromWebContents(handle.webContents);

  // The pane is the window, so show, hide and placement have nothing to do.
  const inPane = () => {};
  win.show = inPane;
  win.showInactive = inPane;
  win.hide = inPane;
  win.focus = inPane;
  win.setPosition = inPane;
  win.setBounds = inPane;
  win.isVisible = () => true;
  win.setVisibleOnAllWorkspaces = inPane;

  app.on('will-quit', () => root.stop(0));
  quitOnSignals();
  return win;
}

// The Quitter's flush, close and exit caps add up to 9 seconds.
const QUIT_CAP_MS = 9000;

/*
 * Pixel exits at once on SIGHUP and SIGTERM, which drops edits the autosave has not written.
 * A normal quit runs the Quitter's flush first. Later signals change nothing, and the cap ends the host.
 */
function quitOnSignals() {
  let quitting = false;
  const quit = (code) => {
    if (quitting) return;
    quitting = true;
    setTimeout(() => app.exit(code), QUIT_CAP_MS).unref();
    app.quit();
  };
  for (const [signal, code] of [['SIGHUP', 129], ['SIGTERM', 143]]) {
    process.removeAllListeners(signal);
    process.on(signal, () => quit(code));
  }
}

// A web view shows the page, so the panel's window stays hidden and empty.
function hiddenPanelWindow(options) {
  const win = new realElectron.BrowserWindow({ ...options, show: false });
  const inert = () => {};
  win.show = inert;
  win.showInactive = inert;
  win.hide = inert;
  win.focus = inert;
  win.loadFile = async () => {};
  win.loadURL = async () => {};
  win.isVisible = () => true;
  return win;
}

// An ordinary window on the right of the screen, where a split would sit.
function ownPanelWindow(options) {
  const { x: _x, y: _y, ...rest } = options;
  const { screen, Menu } = realElectron;
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(1100, Math.round(area.width * 0.55));
  const bounds = { x: area.x + area.width - width - 24, y: area.y + 24, width, height: area.height - 48 };
  const owner = process.env.HWS_SURFACE_OWNER;
  const title = [process.env.HWS_SURFACE_TITLE || 'Board', owner].filter(Boolean).join(' — ');
  const win = new realElectron.BrowserWindow({ ...rest, ...bounds, show: false, focusable: true, frame: true, enableLargerThanScreen: false });

  const inert = () => {};
  const reveal = win.show.bind(win);
  const takeFocus = win.focus.bind(win);
  let ready = false;

  // Panel treats a surface as offscreen, so every show arrives here as showInactive.
  const raise = () => {
    if (!ready) return;
    if (win.isMinimized()) win.restore();
    reveal();
    takeFocus();
    app.focus({ steal: true });
  };
  Object.assign(win, { show: inert, showInactive: raise, hide: inert, focus: inert, setPosition: inert, setBounds: inert });

  const float = (on) => win.setAlwaysOnTop(on, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.once('ready-to-show', () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { label: 'Window', submenu: [{ label: 'Keep on Top', type: 'checkbox', checked: false, click: (item) => float(item.checked) }, { role: 'minimize' }, { role: 'close' }] },
    ]));
    ready = true;
    raise();
  });
  win.setTitle(title);
  win.on('page-title-updated', (event) => event.preventDefault());
  win.on('close', () => setImmediate(() => app.quit()));
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && input.key === 'Enter') {
      event.preventDefault();
      globalThis.__surfaceDone?.();
    }
  });
  return win;
}

function PixelBrowserWindow(options) {
  const isPanel = options?.title === 'Agent Brief' && options?.webPreferences?.preload;
  if (!isPanel) return new realElectron.BrowserWindow(options);
  if (process.env.HWS_SURFACE_WINDOW === '1') return ownPanelWindow(options);
  return process.env.HWS_SURFACE_WEB === '1' ? hiddenPanelWindow(options) : adoptPanelWindow(options);
}
Object.setPrototypeOf(PixelBrowserWindow, realElectron.BrowserWindow);
PixelBrowserWindow.prototype = realElectron.BrowserWindow.prototype;

const shimmedElectron = {};
for (const key of Object.getOwnPropertyNames(realElectron)) {
  if (key === 'BrowserWindow') continue;
  Object.defineProperty(shimmedElectron, key, { enumerable: true, get: () => realElectron[key] });
}
Object.defineProperty(shimmedElectron, 'BrowserWindow', { enumerable: true, value: PixelBrowserWindow });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron' && parent?.filename === mainBundle) return shimmedElectron;
  return originalLoad.call(this, request, parent, isMain);
};

// The main bundle hides the app for a surface. A surface with its own window keeps the Dock icon and Edit menu.
if (process.env.HWS_SURFACE_WINDOW === '1') {
  app.setActivationPolicy = () => {};
  if (app.dock) app.dock.hide = () => {};
}

app.setPath('logs', path.join(process.env.COMPANION_DATA_DIR, 'logs'));
app.setAppPath(appDir);

try {
  require(mainBundle);
} catch (error) {
  fatal('main bundle', error);
}
