/**
 * Auto-update integration via electron-updater. Updates are checked silently
 * at startup and applied on user confirmation; the publish channel is the
 * GitHub Releases of the publishing repository (electron-builder.yml).
 * @module @deepseek-ai/dsh-electron/updater
 */

import { app, BrowserWindow, dialog } from 'electron'
import updaterModule from 'electron-updater'
import type { DesktopServer } from './server.ts'

/**
 * Enable auto-update checks. No-op in development: updates only make sense
 * for a packaged build with a configured publish feed.
 * @param getWindow - resolves the live main window for update dialogs.
 * @param getServer - resolves the live harness server (quiesced during install).
 */
export function initUpdater(
  getWindow: () => BrowserWindow | undefined,
  getServer: () => DesktopServer | undefined,
): void {
  if (!app.isPackaged) return
  updaterModule.autoUpdater.autoDownload = false
  updaterModule.autoUpdater.autoInstallOnAppQuit = true

  updaterModule.autoUpdater.on('update-available', (info) => {
    const window = getWindow()
    if (window === undefined) return
    void dialog.showMessageBox(window, {
      type: 'info',
      title: 'Update available',
      message: `DeepSeek Harness ${info.version} is available.`,
      detail: 'Download and install now?',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) void updaterModule.autoUpdater.downloadUpdate()
    })
  })

  updaterModule.autoUpdater.on('update-downloaded', () => {
    const window = getWindow()
    if (window === undefined) return
    void dialog.showMessageBox(window, {
      type: 'info',
      title: 'Update ready',
      message: 'The update has been downloaded.',
      detail: 'Quit and install now?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(async ({ response }) => {
      if (response !== 0) return
      // Quiesce the harness before the app relaunches.
      await getServer()?.dispose()
      updaterModule.autoUpdater.quitAndInstall()
    })
  })

  updaterModule.autoUpdater.on('error', (error) => {
    // A failed check must not block startup; the next launch retries.
    console.warn('dsh-electron: auto-update check failed', error)
  })

  void updaterModule.autoUpdater.checkForUpdates()
}
