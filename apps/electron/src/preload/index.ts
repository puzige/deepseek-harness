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
// macOS frameless titlebar: a slim top strip holds the traffic lights
// ---------------------------------------------------------------------------
// With `titleBarStyle: 'hiddenInset'` the page fills the window edge-to-edge
// and the system traffic lights float over the top-left content. Embedding
// them inside the sidebar's brand row crowds the wordmark against the panel
// toggle, so instead the lights occupy a slim 28px strip at the very top —
// far shorter than a native title bar, yet the brand row keeps its natural
// spacing. The strip is also the window's drag surface, and its buttons are
// re-bound to no-drag so they stay clickable.
//
// Class names are matched by substring because the harness frontend builds
// its CSS Modules with hashed locals (`_logoRow_<hash>_38`); the harness is
// never rebuilt for this app, so the selectors stay descriptive here.
// A marker class (`dsh-electron-darwin`) scopes every rule so the styles are
// inert if the page is ever loaded outside Electron.
// ---------------------------------------------------------------------------
if (process.platform === 'darwin') {
  /** Height of the reserved top strip, in pixels. */
  const STRIP_HEIGHT = 28

  const installDarwinChrome = (): void => {
    // Guard against double-injection (e.g. if preload runs twice).
    if (document.getElementById('dsh-electron-darwin-css') !== null) return
    document.documentElement.classList.add('dsh-electron-darwin')

    const style = document.createElement('style')
    style.id = 'dsh-electron-darwin-css'
    style.textContent = `
      html.dsh-electron-darwin {
        --dsh-electron-strip: ${STRIP_HEIGHT}px;
      }
      html.dsh-electron-darwin body {
        /* Reserve the slim strip for the traffic lights. */
        padding-top: var(--dsh-electron-strip) !important;
        box-sizing: border-box !important;
        background-color: var(--dsw-alias-bg-base, #0f1115);
      }
      /* The strip itself is the drag surface; its buttons stay clickable. */
      html.dsh-electron-darwin #dsh-electron-drag-strip {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        height: var(--dsh-electron-strip);
        z-index: 2147483647;
        -webkit-app-region: drag;
      }
    `
    document.head.appendChild(style)

    const strip = document.createElement('div')
    strip.id = 'dsh-electron-drag-strip'
    strip.style.cssText = [
      'position: fixed',
      'top: 0',
      'left: 84px',
      'right: 0',
      `height: ${STRIP_HEIGHT}px`,
      'z-index: 2147483647',
      '-webkit-app-region: drag',
      'pointer-events: none',
    ].join(';')
    document.documentElement.appendChild(strip)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installDarwinChrome)
  } else {
    installDarwinChrome()
  }
}

export type DesktopBridge = typeof bridge
