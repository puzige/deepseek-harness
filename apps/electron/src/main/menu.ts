/**
 * Native application menu for the desktop client.
 *
 * macOS shows the application menu in the system menu bar at the top of the
 * screen. The desktop client hides that bar (`Menu.setApplicationMenu(null)`)
 * for a clean shell and re-binds the standard accelerators it would have
 * provided through a `before-input-event` handler — Cmd/Ctrl+C/V/X/A/Z/Y,
 * reload, zoom, and DevTools. Cmd+Q stays system-owned on macOS (the app
 * terminates through the standard `terminate:` action) and menu-owned on
 * Windows/Linux, where the ordinary in-window menu remains.
 * @module @deepseek-ai/dsh-electron/menu
 */

import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/** One re-bound accelerator: the plain key, an optional Shift requirement, and the action. */
interface Accelerator {
  /** The key to match (already lower-cased). */
  key: string
  /** `true` requires Shift held; `false` requires it absent. */
  shift: boolean
  /** Run the action on the given window. */
  run: (window: BrowserWindow) => void
}

/** The accelerators the hidden macOS menu would otherwise own. */
const ACCELERATORS: Accelerator[] = [
  { key: 'c', shift: false, run: (window) => { window.webContents.copy() } },
  { key: 'x', shift: false, run: (window) => { window.webContents.cut() } },
  { key: 'v', shift: false, run: (window) => { window.webContents.paste() } },
  { key: 'a', shift: false, run: (window) => { window.webContents.selectAll() } },
  { key: 'z', shift: false, run: (window) => { window.webContents.undo() } },
  { key: 'y', shift: false, run: (window) => { window.webContents.redo() } },
  { key: 'r', shift: false, run: (window) => { window.webContents.reload() } },
  { key: 'r', shift: true, run: (window) => { window.webContents.reloadIgnoringCache() } },
  { key: 'i', shift: true, run: (window) => { window.webContents.toggleDevTools() } },
  { key: '0', shift: false, run: (window) => { window.webContents.setZoomLevel(0) } },
  { key: '=', shift: false, run: (window) => { window.webContents.setZoomLevel(window.webContents.getZoomLevel() + 1) } },
  { key: '-', shift: false, run: (window) => { window.webContents.setZoomLevel(window.webContents.getZoomLevel() - 1) } },
]

/** Whether this input carries the platform command modifier (Cmd on macOS, Ctrl elsewhere). */
function isCommand(input: Electron.Input): boolean {
  return process.platform === 'darwin' ? input.meta : input.control
}

/**
 * Re-bind the accelerators the hidden macOS menu would otherwise own, on the
 * given window's webContents. Idempotent per window.
 * @param window - the window whose webContents receives the input events.
 */
export function installAcceleratorHandler(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (!isCommand(input) || input.type !== 'keyDown' || input.key.length !== 1) return
    const key = input.key.toLowerCase()
    const accelerator = ACCELERATORS.find(candidate =>
      candidate.key === key && candidate.shift === input.shift)
    if (accelerator === undefined) return
    event.preventDefault()
    accelerator.run(window)
  })
}

/**
 * Install the application menu. On macOS the system menu bar is hidden
 * entirely and the standard accelerators are re-bound manually; elsewhere the
 * full in-window menu stays. Cmd+Q on macOS remains system-owned.
 * @param getWindow - resolves the live main window for window-targeted items.
 */
export function createMenu(getWindow: () => BrowserWindow | undefined): void {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(null)
    const window = getWindow()
    if (window !== undefined) installAcceleratorHandler(window)
    return
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send('menu:new-session'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'DeepSeek Harness on GitHub',
          click: () => { void import('electron').then(({ shell }) => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness')) },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
