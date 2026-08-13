/**
 * Preload bridge for the DeepSeek Harness renderer.
 *
 * Exposes a minimal, typed desktop API under `window.__DSH_ELECTRON__` while
 * keeping the renderer sandboxed: no Node.js globals reach the page. The web
 * UI may feature-detect the desktop shell via `window.__DSH_ELECTRON__`.
 * @module @deepseek-ai/dsh-electron/preload
 */

import { contextBridge, ipcRenderer } from 'electron'

/**
 * The desktop bridge surface exposed to the renderer. Keep this interface
 * narrow: window controls, environment facts, and event subscriptions.
 */
const bridge = {
  /** True when running inside the desktop shell (vs a plain browser tab). */
  isDesktop: true,
  /** Platform facts the UI may want to branch on. */
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** Window control for custom title bars. */
  window: {
    minimize: (): void => { ipcRenderer.send('window:minimize') },
    maximize: (): void => { ipcRenderer.send('window:maximize') },
    close: (): void => { ipcRenderer.send('window:close') },
  },
  /** Subscribe to main-process events; returns an unsubscribe function. */
  on: (channel: 'menu:new-session' | 'deeplink', listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => { listener(payload) }
    ipcRenderer.on(channel, wrapped)
    return () => { ipcRenderer.removeListener(channel, wrapped) }
  },
} as const

contextBridge.exposeInMainWorld('__DSH_ELECTRON__', bridge)

export type DesktopBridge = typeof bridge
