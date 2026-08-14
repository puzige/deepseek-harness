/**
 * DeepSeek Harness desktop client — Electron main process entry.
 *
 * The main process boots the dsh `web` profile in-process (see server.ts),
 * opens a BrowserWindow over the served loopback URL, and owns the desktop
 * lifecycle: tray, native menu, deep link, and auto-update.
 * @module @deepseek-ai/dsh-electron/main
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
// Must run before any @deepseek-ai package loads: the hook restores the
// dependency-closure resolution the Electron realm cannot reach through
// Node's internal loader.
import { installResolveHooks } from './resolve-hooks.ts'
import { takePendingDeepLink } from './deeplink.ts'
import { createMenu } from './menu.ts'
import { createTray, disposeTray } from './tray.ts'
import { registerDeepLink } from './deeplink.ts'
import { startServer, type DesktopServer } from './server.ts'
import { initUpdater } from './updater.ts'

// Module top level: the hook must be registered before the harness imports
// below (server.ts and its @deepseek-ai/* transitives) finish loading.
installResolveHooks()

/** The single desktop server instance, while the app is running. */
let server: DesktopServer | undefined
/** The single main window, while it exists. */
let mainWindow: BrowserWindow | undefined

/**
 * Resolve the preload script path for the current runtime layout: electron-vite
 * emits `out/preload/index.mjs` (ESM preload, sandbox: false) in both dev and
 * packaged layouts.
 * @returns the absolute preload path.
 */
function preloadPath(): string {
  return join(__dirname, '../preload/index.mjs')
}

/**
 * Create the main window over the served URL and wire its lifecycle.
 * @param url - the loopback URL served by the booted harness.
 */
function createMainWindow(url: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0f1115',
    // macOS: hide the title bar text while keeping the traffic-light controls.
    // The lights sit in a slim 28px strip at the very top of the window (not
    // inside the sidebar's brand row, where they would crowd the wordmark),
    // so the header keeps its natural breathing room.
    ...(process.platform === 'darwin' ? {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 14, y: 8 },
    } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // External links leave the desktop shell for the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (target !== url && /^https?:\/\//.test(target)) {
      event.preventDefault()
      void shell.openExternal(target)
    }
  })

  void mainWindow.loadURL(url)

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`dsh-electron: window loaded ${url}`)
    const pending = takePendingDeepLink()
    if (pending !== undefined) mainWindow?.webContents.send('deeplink', pending)
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
    console.error(`dsh-electron: window failed to load (${code}) ${description}`)
  })

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

/**
 * Boot the harness, open the window, and start the desktop extras.
 * Failures tear the tree down so the app can report and exit cleanly.
 */
async function startDesktop(): Promise<void> {
  try {
    server = await startServer()
  } catch (error) {
    console.error('dsh-electron: failed to boot the harness', error)
    app.exit(1)
    return
  }
  createMainWindow(server.url)
  createTray(() => mainWindow)
  createMenu(() => mainWindow)
  registerDeepLink(() => mainWindow)
  initUpdater(() => mainWindow, () => server)
}

// A second instance forwards to the running window instead of booting again.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    void startDesktop()
    // macOS convention: re-create the window on dock click.
    app.on('activate', () => {
      if (mainWindow === undefined && server !== undefined) createMainWindow(server.url)
    })
  })
}

// The harness owns child processes; dispose the tree before the app exits.
app.on('before-quit', () => {
  disposeTray()
  void server?.dispose()
})

// Renderer → main IPC: window controls for a frameless-capable UI.
ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow === undefined) return
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
