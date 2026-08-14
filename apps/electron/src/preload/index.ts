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

// ---------------------------------------------------------------------------
// macOS frameless titlebar: embed the traffic lights into the sidebar header
// ---------------------------------------------------------------------------
// With `titleBarStyle: 'hiddenInset'` the page fills the window edge-to-edge
// and the system traffic lights float over the sidebar's brand row. Two
// adjustments make the chrome read as part of the header rather than a strip
// above it:
//
//   • `trafficLightPosition` (set in main/index.ts) lowers the buttons into
//     the brand row's vertical center. The brand wordmark starts at the
//     sidebar's left edge, so the lights would overlap it; a left margin on
//     the brand button shifts the wordmark right of the lights.
//   • The brand row becomes the window's drag surface
//     (`-webkit-app-region: drag`), while its buttons stay clickable
//     (`no-drag`), so the user moves the window by dragging the header — no
//     extra overlay, no reserved padding, and the conversation area extends
//     under the top edge like a native macOS app.
//
// Class names are matched by substring because the harness frontend builds
// its CSS Modules with hashed locals (`_logoRow_<hash>_38`); the harness is
// never rebuilt for this app, so the selectors stay descriptive here.
// A marker class (`dsh-electron-darwin`) scopes every rule so the styles are
// inert if the page is ever loaded outside Electron.
// ---------------------------------------------------------------------------
if (process.platform === 'darwin') {
  const installDarwinChrome = (): void => {
    // Guard against double-injection (e.g. if preload runs twice).
    if (document.getElementById('dsh-electron-darwin-css') !== null) return
    document.documentElement.classList.add('dsh-electron-darwin')

    const style = document.createElement('style')
    style.id = 'dsh-electron-darwin-css'
    style.textContent = `
      /* Sidebar brand row: the drag surface, with the traffic lights embedded
         at its left edge (trafficLightPosition in main/index.ts). */
      html.dsh-electron-darwin [class*='logoRow'] {
        -webkit-app-region: drag;
      }
      /* Buttons inside the row stay clickable and do not start a drag. */
      html.dsh-electron-darwin [class*='logoRow'] button {
        -webkit-app-region: no-drag;
      }
      /* Shift the brand wordmark right of the traffic lights. */
      html.dsh-electron-darwin [class*='logoRow'] [class*='brand'] {
        margin-left: 72px;
      }
    `
    document.head.appendChild(style)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installDarwinChrome)
  } else {
    installDarwinChrome()
  }
}

export type DesktopBridge = typeof bridge
