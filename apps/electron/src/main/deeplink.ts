/**
 * Deep-link protocol registration (`dsh://`). A second instance launched
 * with a deep link forwards the URL to the running window.
 * @module @deepseek-ai/dsh-electron/deeplink
 */

import { app, BrowserWindow } from 'electron'

/** The protocol scheme this client registers. */
const DSH_SCHEME = 'dsh'

/** The most recent deep link, consumed by the window once it loads. */
let pendingUrl: string | undefined

/**
 * Register `dsh://` as this app's protocol handler.
 * @param getWindow - resolves the live main window to route links to.
 */
export function registerDeepLink(getWindow: () => BrowserWindow | undefined): void {
  // macOS registers through the app bundle manifest; Windows/Linux register
  // the protocol at runtime (and on Windows, in the installer).
  if (process.defaultApp && process.argv.length >= 2 && process.argv[1] !== undefined) {
    app.setAsDefaultProtocolClient(DSH_SCHEME, process.execPath, [process.argv[1]])
  } else {
    app.setAsDefaultProtocolClient(DSH_SCHEME)
  }

  app.on('open-url', (event, url) => {
    event.preventDefault()
    routeDeepLink(url, getWindow())
  })

  // Windows/Linux: the protocol handler launches a second instance.
  app.on('second-instance', (_event, argv) => {
    const url = argv.find(arg => arg.startsWith(`${DSH_SCHEME}://`))
    if (url !== undefined) routeDeepLink(url, getWindow())
  })
}

/**
 * Route a deep link to the window (or stash it until the window exists).
 * @param url - the `dsh://` URL.
 * @param window - the live main window, if any.
 */
function routeDeepLink(url: string, window: BrowserWindow | undefined): void {
  if (window === undefined || window.webContents.isLoading()) {
    pendingUrl = url
    return
  }
  window.webContents.send('deeplink', url)
  if (window.isMinimized()) window.restore()
  window.focus()
}

/**
 * Consume the stashed deep link once the window finished loading.
 * Called by the main process after first paint.
 * @returns the pending deep link, if one was waiting.
 */
export function takePendingDeepLink(): string | undefined {
  const url = pendingUrl
  pendingUrl = undefined
  return url
}
