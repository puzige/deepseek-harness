/**
 * Native application menu for the desktop client: macOS standard roles plus
 * the cross-platform harness actions.
 * @module @deepseek-ai/dsh-electron/menu
 */

import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Install the application menu.
 * @param getWindow - resolves the live main window for window-targeted items.
 */
export function createMenu(getWindow: () => BrowserWindow | undefined): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : [],
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => getWindow()?.webContents.send('menu:new-session'),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [{ role: 'close' as const }],
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
