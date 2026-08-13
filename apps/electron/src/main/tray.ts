/**
 * System tray integration: the desktop client keeps running in the tray after
 * the window closes, with quick actions on the tray menu.
 * @module @deepseek-ai/dsh-electron/tray
 */

import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

/** The live tray instance, if created. */
let tray: Tray | undefined

/**
 * Create the tray icon and menu. Idempotent: repeated calls replace the tray.
 * @param getWindow - resolves the live main window for window-targeted items.
 */
export function createTray(getWindow: () => BrowserWindow | undefined): void {
  if (tray !== undefined) {
    tray.destroy()
    tray = undefined
  }

  // A small template image keeps the icon adaptive to light/dark menu bars.
  // Falls back to the app icon when the template asset is absent (packaging).
  const iconPath = join(__dirname, '../../resources/trayTemplate.png')
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin' && !image.isEmpty()) image.setTemplateImage(true)
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image)

  const showWindow = (): void => {
    const window = getWindow()
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open DeepSeek Harness',
      click: showWindow,
    },
    {
      label: 'New Session',
      click: () => getWindow()?.webContents.send('menu:new-session'),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => { app.quit() },
    },
  ]))

  // Clicking the tray icon (Windows/Linux) restores the window.
  tray.on('click', showWindow)
}

/**
 * Dispose the tray. Called during shutdown.
 */
export function disposeTray(): void {
  tray?.destroy()
  tray = undefined
}
