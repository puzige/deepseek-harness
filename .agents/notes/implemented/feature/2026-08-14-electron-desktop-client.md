# Agent Note: Electron desktop client over the web profile

Status: implemented

English | [中文](2026-08-14-electron-desktop-client.zh.md)

## Problem

`dsh` is a local harness whose interactive surface is a browser UI: `dsh --profile web` boots the web bundle, serves a built frontend over loopback HTTP, and the user opens it in a system browser. A desktop client should give macOS/Windows/Linux users a native installable app with tray, menu, deep-link, and auto-update — without duplicating the harness or rewriting the frontend. The plan is "bridge, not rewrite": Electron's main process is Node, and the whole plugin tree is designed to run in one process, so the desktop shell can boot the exact same `web` profile in-process and point a `BrowserWindow` at the served URL.

The hard part is module resolution. The CLI resolves Cordis plugin rows through Node's internal `ModuleLoader` (`loader.internal`): each plugin specifier imports against the profile directory's `baseUrl`, and the flat fallback `$DSH_HOME/profiles/node_modules` (maintained by `healProfilesModuleFallback`) serves the full dependency closure. Electron's main process cannot use that path — `node-addon-require-builtin` (which the loader needs to reach `internal/modules/esm/loader`) is incompatible with Electron's V8 realm — so `loader.internal` is undefined and plugin rows fall back to plain `import(name)` resolved from the bundle, whose `node_modules` only holds direct dependencies. Transitive plugin packages (`dsh-llm`, `dsh-session`, …) fail to resolve.

## Decision

**New app `apps/electron` (`@deepseek-ai/dsh-electron`, private) is a product assembly like `apps/cli` and `apps/web`.** It depends on the same workspace packages the CLI ships (`dsh-base`, `dsh-web-app`, the full web profile closure), so the profile directory `$DSH_HOME/profiles/web` is shared: credentials, settings, and user patches apply to both surfaces. The main process boots the `web` profile with `--host 127.0.0.1 --port 0` (OS-assigned port), so a desktop session never collides with a concurrent `dsh web`. The `BrowserWindow` loads `http://127.0.0.1:{port}` — the exact page a browser tab gets, served by the harness's own `frontend-static` — with `contextIsolation: true` and a narrow preload bridge under `window.__DSH_ELECTRON__`. No frontend code changes.

**`resolve-hooks.ts` restores the closure via Node's `registerHooks` (Node 24; Electron 43 ships Node 24).** A resolve hook maps every `@deepseek-ai/*` specifier through a BFS over the installation's dependency graph — the same closure `healProfilesModuleFallback` links — returning the resolved package entry URL directly instead of writing symlinks. The hook must handle subpath specifiers too, because Node 24's CJS `require.resolve` walks registerHooks: harness packages probing `${pkg}/package.json` (typert-loader, client-modules) arrive at the hook; a `package.json`-suffixed subpath resolves to the manifest itself, and a missing one returns `undefined` so the caller's existing "not a contributor" degradation path runs (the same verdict `require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for on the CLI).

**Two Electron-realm constraints degrade instead of failing loud.** The Cordis HMR service requires `--expose-internals`; a desktop boot skips config hot-reload with a warning (edits apply on restart), while the CLI keeps its live-reload contract. And Node 24's `require(esm)` rejects a module that a parallel dynamic import is still loading (`ERR_REQUIRE_ESM_RACE_CONDITION`), which the loader's parallel plugin fan-out triggers; `startServer` serially warms `cosmokit`/`schemastery`/`cordis` before booting so the CJS→ESM require path never races.

**Desktop extras stay thin and standard.** `menu.ts` (native roles + New Session), `tray.ts` (template image, show/quit), `deeplink.ts` (`dsh://` protocol, second-instance routing), `updater.ts` (electron-updater, packaged builds only). Packaging is `electron-vite` (main + preload only — no renderer bundle, the harness serves the dist) plus `electron-builder` with `asarUnpack` for native modules. `pnpm-workspace.yaml` allows the `electron`/`electron-winstaller` build scripts; `tsconfig.host.json` and `knip.json` register the new app.

## Alternatives considered

**Reuse `apps/cli`'s `runProfile` in the desktop main process.** Rejected: the CLI bundles a single `bin.js` and exports no library surface, so the boot glue would have to ship as a new shared package anyway. The desktop app instead composes the same primitives (`boot`, `composeEntries`, `loadProfile`, `loadOptionalPatches`, `watchUserPatches`) directly — the glue is app-owned, mirroring how each assembly owns its launcher.

**Spawn the `dsh` CLI as a child process.** Rejected: a second Node runtime inside the app is heavier, complicates tray/menu/deep-link coordination, and forfeits the in-process tree teardown on quit.

**Extract the shared profile-composition glue into `dsh-app-boot`.** Deferred: `composeProfile`/`prepareProfile` in `apps/cli/src/profile-boot.ts` are app glue, and consolidating them is a separate cleanup that touches the CLI's boot path; the desktop app currently mirrors the composition (bundles → user layer → home layer → telemetry switch → shipped agent-preset root), with the note that a later change may extract it.

**Use `electron-vite`'s renderer build instead of serving the harness dist.** Rejected: the whole point of the bridge is that the web profile owns the frontend; a second build pipeline would fork the UI. The renderer config is intentionally absent.

## Consequences

A desktop build (`apps/electron`) now boots the shared `web` profile in-process and serves the existing frontend over an OS-assigned loopback port, so credentials, settings, and user patches are identical across the CLI and desktop surfaces. The Electron realm loses config hot-reload (cold restarts apply `cordis.patch.yml` edits) and gains tray/menu/deep-link/auto-update chrome; the plugin dependency closure resolves through `registerHooks` instead of the internal loader, and core ESM modules are warmed serially to avoid Node 24's `require(esm)` race. Packaging targets all three platforms with signing deferred until certificates exist; the release channel is a separate `electron-v*` tag so the npm dsh sequence is untouched. The composition glue in `apps/cli/src/profile-boot.ts` remains duplicated in `apps/electron/src/main/server.ts`; a later change may extract it into `dsh-app-boot`.
