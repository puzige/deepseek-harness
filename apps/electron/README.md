# `@deepseek-ai/dsh-electron`

English | [中文](README.zh.md)

The DeepSeek Harness desktop client: an Electron shell over the `web` profile. The main process boots the exact Cordis tree `dsh web` boots — same `$DSH_HOME/profiles/web`, same plugins, same served frontend — and a `BrowserWindow` loads the loopback URL. No harness code is rewritten and no renderer is bundled: the window receives the same page a browser tab gets.

## Why this works

`dsh` is "everything is a plugin" on a vendored Cordis microkernel, and Electron's main process *is* Node, so the whole plugin tree runs unmodified inside it. The desktop app is a transport shell: boot → serve → point a window at it. See the [Agent Note](../../.agents/notes/implemented/feature/2026-08-14-electron-desktop-client.md) for the two Electron-realm constraints this bridges (dependency-closure resolution and the `require(esm)` race) and why they degrade instead of fail.

## Layout

| Path | Owns |
|---|---|
| [`src/main/index.ts`](src/main/index.ts) | Window lifecycle, single-instance lock, IPC window controls |
| [`src/main/server.ts`](src/main/server.ts) | In-process `web` profile boot on an OS-assigned loopback port |
| [`src/main/resolve-hooks.ts`](src/main/resolve-hooks.ts) | `registerHooks` resolve hook restoring the plugin dependency closure |
| [`src/main/menu.ts`](src/main/menu.ts) | Native application menu |
| [`src/main/tray.ts`](src/main/tray.ts) | System tray with show/quit actions |
| [`src/main/deeplink.ts`](src/main/deeplink.ts) | `dsh://` protocol registration and second-instance routing |
| [`src/main/updater.ts`](src/main/updater.ts) | electron-updater integration (packaged builds only) |
| [`src/preload/index.ts`](src/preload/index.ts) | Narrow `contextBridge` surface under `window.__DSH_ELECTRON__` |
| [`electron-builder.yml`](electron-builder.yml) | macOS/Windows/Linux packaging targets |

## Development

From the repository root, build the workspace libraries and web dist once, then run the app:

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-electron run dev
```

The app shares the CLI's profile and credentials: anything configured under `dsh web` (or in `$DSH_HOME`) is already visible here. The window loads the served frontend; open DevTools from the View menu.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-electron run package        # current platform
pnpm --filter @deepseek-ai/dsh-electron run package:mac   # dmg + zip (x64, arm64)
pnpm --filter @deepseek-ai/dsh-electron run package:win   # nsis + portable
pnpm --filter @deepseek-ai/dsh-electron run package:linux # AppImage + deb
```

Artifacts land in `apps/electron/release/`. Code signing and notarization are off until certificates exist; unsigned builds install with a manual trust step. Auto-update reads the `publish` stanza (GitHub Releases) and checks only in packaged builds.

## Testing

```sh
pnpm vitest run apps/electron/tests
```
