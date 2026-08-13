/**
 * ESM resolve hooks for the Electron main process.
 *
 * The dsh CLI resolves its Cordis plugin rows through Node's internal
 * ModuleLoader (`loader.internal`), which imports each plugin specifier
 * against the profile directory's `baseUrl`; the flat module fallback
 * `$DSH_HOME/profiles/node_modules` (maintained by
 * `healProfilesModuleFallback`) then serves the full dependency closure.
 * Electron's main process cannot use that path: `node-addon-require-builtin`
 * (which the loader needs to reach `internal/modules/esm/loader`) is
 * incompatible with Electron's V8 realm, so `loader.internal` is undefined
 * and plugin rows fall back to plain `import(name)` resolved from the bundle.
 * The bundle's own `node_modules` only holds direct dependencies, so
 * transitive plugin packages (dsh-llm, dsh-session, …) would fail to resolve.
 *
 * This module restores the closure by registering a Node `registerHooks`
 * resolve hook (Node 24; Electron 43 ships Node 24) that maps every
 * `@deepseek-ai/*` specifier through the same BFS over the installation's
 * dependency graph that `healProfilesModuleFallback` uses — but returns the
 * resolved package directory directly instead of writing symlinks. The hook
 * runs before any harness package loads (the caller imports this module
 * first), and it never imports a harness package itself, so the BFS cannot
 * deadlock on its own hook.
 * @module @deepseek-ai/dsh-electron/resolve-hooks
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Absolute path of this app's package.json (src/main and out/main both sit two levels under apps/electron). */
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))

/** Package name → real directory, filled by the closure BFS on first use. */
let closure: Map<string, string> | undefined

interface Manifest {
  name?: unknown
  main?: unknown
  exports?: unknown
  type?: unknown
}

/** Read and shape-check a package.json without trusting its parse type. */
function readManifest(path: string): Manifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Manifest | null
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`dsh-electron: malformed package.json at ${path}`)
  }
  return parsed
}

/**
 * Resolve one package's root directory from an anchor's require paths (the
 * same lookup order Node itself uses, so the result matches what the Loader
 * would import from the same anchor). `existsSync` follows pnpm's symlinks.
 * @param anchor - absolute path of a package.json to resolve from.
 * @param packageName - the package name to locate.
 * @returns the package's absolute directory, or `undefined` when not resolvable.
 */
function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
  /* v8 ignore next -- createRequire always resolves from a real anchor */
  for (const searchPath of createRequire(anchor).resolve.paths(packageName) ?? []) {
    const candidate = join(searchPath, packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate
  }
  return undefined
}

/**
 * Build the installation's dependency closure (dependencies plus peer
 * dependencies, breadth-first like `healProfilesModuleFallback`). Peer
 * dependencies participate because Service Definition packages are peers of
 * their implementations, yet out-of-tree plugins import them directly.
 * @returns the package name → directory map.
 */
function buildClosure(): Map<string, string> {
  const links = new Map<string, string>()
  const queue: { anchor: string; manifest: Manifest }[] = [
    { anchor: INSTALL_ANCHOR, manifest: readManifest(INSTALL_ANCHOR) },
  ]
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const manifest = next.manifest as Manifest & { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
    for (const dep of [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]) {
      if (links.has(dep)) continue
      const dir = packageDirFromAnchor(next.anchor, dep)
      // A declared-but-uninstalled dependency cannot be a loader-visible
      // plugin; skip it rather than fail the whole boot.
      if (dir === undefined) continue
      links.set(dep, dir)
      queue.push({ anchor: join(dir, 'package.json'), manifest: readManifest(join(dir, 'package.json')) })
    }
  }
  return links
}

/**
 * Resolve one closure package to its runtime entry URL. Prefers the
 * `exports` map's `default` target (the tsdown layout: `lib/<name>.js`),
 * then falls back to `main`/`index.js`.
 *
 * Subpath specifiers need the same treatment: Node's CJS `require.resolve`
 * walks registerHooks on Node 24, so harness packages probing
 * `${pkg}/package.json` (typert-loader, client-modules) arrive here too.
 * A `package.json`-suffixed subpath resolves to the manifest file itself;
 * other subpaths resolve through `exports` or the package directory.
 * @param packageDir - the package's absolute directory.
 * @param subpath - the export subpath after the package name (`''` for the root).
 * @returns the entry file URL, or `undefined` when the subpath does not exist.
 */
export function entryUrl(packageDir: string, subpath: string): URL | undefined {
  if (subpath.endsWith('package.json')) {
    const manifestFile = join(packageDir, subpath)
    return existsSync(manifestFile) ? pathToFileURL(manifestFile) : undefined
  }
  const manifest = readManifest(join(packageDir, 'package.json'))
  const exportsMap = manifest.exports
  if (typeof exportsMap === 'object' && exportsMap !== null && !Array.isArray(exportsMap)) {
    const key = subpath === '' ? '.' : `./${subpath}`
    const target = (exportsMap as Record<string, unknown>)[key]
    if (typeof target === 'string') return pathToFileURL(join(packageDir, target))
    if (typeof target === 'object' && target !== null) {
      const conditional = target as Record<string, unknown>
      if (typeof conditional.default === 'string') return pathToFileURL(join(packageDir, conditional.default))
    }
  }
  if (subpath === '') {
    const main = typeof manifest.main === 'string' ? manifest.main : 'index.js'
    return pathToFileURL(join(packageDir, main))
  }
  // No exports entry for this subpath: fall back to the directory layout the
  // package would use without exports, matching Node's legacy resolution.
  const direct = join(packageDir, subpath)
  if (existsSync(direct)) return pathToFileURL(direct)
  const index = join(direct, 'index.js')
  return existsSync(index) ? pathToFileURL(index) : undefined
}

/**
 * Register the resolve hook and warm the closure. Idempotent: a second call
 * returns without re-registering (Node would throw on duplicate hooks).
 */
export function installResolveHooks(): void {
  if (closure !== undefined) return
  closure = buildClosure()
  registerHooks({
    resolve: (specifier, context, nextResolve) => {
      if (!specifier.startsWith('@deepseek-ai/')) return nextResolve(specifier, context)
      const [scope, name, ...subparts] = specifier.split('/')
      if (scope === undefined || name === undefined) return nextResolve(specifier, context)
      const packageName = `${scope}/${name}`
      const dir = closure?.get(packageName)
      if (dir === undefined) return nextResolve(specifier, context)
      const url = entryUrl(dir, subparts.join('/'))
      if (url === undefined) return nextResolve(specifier, context)
      return {
        url: url.href,
        shortCircuit: true,
      }
    },
  })
}
