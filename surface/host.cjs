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

const audioOnly = (kinds) => kinds.every((kind) => kind === 'audio');

function adoptPanelWindow(options) {
  const { createRoot } = require('@zenbu-labs/pixel');
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
  return win;
}

function PixelBrowserWindow(options) {
  const isPanel = options?.title === 'Agent Brief' && options?.webPreferences?.preload;
  return isPanel ? adoptPanelWindow(options) : new realElectron.BrowserWindow(options);
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

app.setPath('logs', path.join(process.env.COMPANION_DATA_DIR, 'logs'));
app.setAppPath(appDir);

try {
  require(mainBundle);
} catch (error) {
  fatal('main bundle', error);
}
