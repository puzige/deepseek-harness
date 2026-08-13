/**
 * Desktop server bootstrap: boot the same `web` profile the browser UI uses,
 * inside the Electron main process. The window then loads the served dist
 * over loopback HTTP exactly like a browser tab, so the desktop client is a
 * transport shell, not a rewrite: every harness plugin (llm/fs/shell/mcp/…)
 * runs unmodified in this process.
 *
 * The profile directory (`$DSH_HOME/profiles/web`) is shared with the `dsh`
 * CLI, so credentials, settings, and user patches apply to both surfaces.
 * @module @deepseek-ai/dsh-electron/server
 */

import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
// Side-effect type import: resolves `ctx.webServer` to the service type.
import type {} from '@deepseek-ai/dsh-host-webserver'
// Side-effect type import: resolves `ctx.loader` for the watch setup.
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Stable process label shared by diagnostics and the profile manifest. */
const NAME = 'dsh-electron'

/** Absolute path of this app's package.json (src/main and out/main both sit two levels under apps/electron). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** Root config filename inside a profile directory. */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over (mirrors apps/cli). */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** The shipped agent-preset root, reused from the dsh CLI package (its `config` ships in the npm payload). */
const SHIPPED_PRESET_ROOT = resolve(
  createRequire(INSTALL_ANCHOR).resolve('@deepseek-ai/dsh/package.json'),
  '../config/agent-presets/',
)

/**
 * Resolve the telemetry opt-out switch into its boot patch (mirrors apps/cli).
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load and prepare the `web` profile: heal the shared module fallback, then
 * (re)write the empty root config (mirrors apps/cli — the file exists on disk
 * only because the Loader needs a real include root to anchor `baseUrl`).
 * @returns the loaded profile.
 */
function prepareProfile(): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, 'web', INSTALL_ANCHOR)
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and the row index of its pre-flag composition. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: the telemetry switch. */
  overlays: PatchOptions[]
  /** id → row of the composed tree, for the launcher's own row checks. */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [...composed.bundlePatches, ...composed.profile.patches, ...composed.homePatches, ...composed.overlays]
}

/**
 * Compose the effective patch stack of the `web` profile: bundle layers in
 * `dsh.profile.bundles` order, the profile's user layer, the home-level user
 * layer, then the telemetry switch. The shipped agent-preset root is patched
 * in exactly as apps/cli does, so shipped presets resolve from the CLI
 * package's config in both source and installed layouts.
 * @returns the profile, its patch layers, and the composed row index.
 */
function composeProfile(): ComposedProfile {
  const profile = prepareProfile()
  const homePatches = loadOptionalPatches(NAME, join(resolveDshHome(), PROFILE_PATCH_FILENAME)) ?? []
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const overlays: PatchOptions[] = []
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: SHIPPED_PRESET_ROOT, trust: 'system' }],
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlays.push(telemetryPatch)
  return { profile, bundlePatches, homePatches, overlays, rows }
}

/** A booted desktop server: the settled root context plus its teardown. */
export interface DesktopServer {
  /** The booted Cordis root context. */
  ctx: Context
  /** The loopback URL the window loads. */
  url: string
  /** Dispose the plugin tree; idempotent. */
  dispose: () => Promise<void>
}

/** Core ESM modules that CJS packages require() synchronously; warming them
 * before the loader's parallel plugin imports removes Node 24's
 * ERR_REQUIRE_ESM_RACE_CONDITION on the require(esm) path. */
const REQUIRE_ESM_WARMUP = ['@deepseek-ai/cosmokit', '@deepseek-ai/schemastery', '@deepseek-ai/cordis'] as const

/**
 * Boot the web profile inside this process and return the window URL.
 *
 * The server binds an OS-assigned loopback port (`--port 0`), so a desktop
 * session never collides with a concurrently running `dsh web`.
 * @returns the settled tree and its dispose handle.
 */
export async function startServer(): Promise<DesktopServer> {
  // Serial warmup before the Cordis loader fans plugin imports out in
  // parallel: schemastery (CJS) require()s cosmokit (ESM), and Node 24's
  // require(esm) rejects a module that a parallel dynamic import is still
  // loading. The CLI never hits this because its loader rides the internal
  // ModuleLoader; the Electron realm falls back to plain import().
  for (const name of REQUIRE_ESM_WARMUP) {
    await import(name)
  }
  const composed = composeProfile()
  const app: { current?: Context } = {}
  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Cloned for the same insert-aliasing reason as apps/cli: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Launch-time environment values resolve from the same immutable snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME))
    // The web startup row parses its flag family from this snapshot; port 0
    // requests an OS-assigned port. Exit is a no-op here — window teardown
    // owns process lifetime in a desktop shell.
    provideCmdline(hostCtx, {
      args: ['--host', '127.0.0.1', '--port', '0'],
      exit: () => { /* window teardown owns exit */ },
    })
  })
  app.current = ctx

  // Config-only HMR for the live profile patch layers: web bundle disables
  // the shared `hmr` row, so mount a watch-only instance with no module roots
  // — cordis.patch.yml edits stay live, matching the CLI contract. The
  // Electron realm cannot host the HMR service (it requires Node's internal
  // loader, which node-addon-require-builtin cannot reach here), so a desktop
  // boot degrades to cold restarts for config edits instead of failing loud:
  // the CLI contract is for the CLI surface, and the tree must boot.
  if (ctx.get('loader') !== undefined) {
    let watchable = false
    try {
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      watchable = true
    } catch (error) {
      console.warn(`${NAME}: config hot-reload unavailable (${String(error)}); edits apply on restart`)
    }
    if (watchable) {
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: () => structuredClone(allPatches(composed)),
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: join(resolveDshHome(), PROFILE_PATCH_FILENAME),
        compose: () => structuredClone(allPatches(composed)),
      })
    }
  }

  const port = ctx.get('webServer')?.port
  if (port === undefined) {
    await ctx.fiber.dispose()
    throw new Error(`${NAME}: webServer service did not bind; see the boot log above`)
  }
  return {
    ctx,
    url: localWebUrl(port),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

/**
 * Render the loopback URL for a bound port — the address the window loads.
 * @param port - the OS-assigned port from the webServer service.
 * @returns the canonical local URL.
 */
export function localWebUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`
}
