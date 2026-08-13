/**
 * Unit tests for the ESM resolve hooks: package-closure entry resolution.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { entryUrl } from '../src/main/resolve-hooks.ts'

/** Fixture package dir: a minimal package with tsdown-style exports. */
const fixtureDir = fileURLToPath(new URL('./fixtures/pkg-a/', import.meta.url))

describe('entryUrl', () => {
  it('resolves the root entry through the exports default', () => {
    expect(entryUrl(fixtureDir, '')?.href).toBe(new URL('./lib/index.js', `file://${fixtureDir}`).href)
  })

  it('resolves a subpath entry through the exports map', () => {
    expect(entryUrl(fixtureDir, 'startup')?.href).toBe(new URL('./lib/startup.js', `file://${fixtureDir}`).href)
  })

  it('resolves a package.json probe to the manifest itself (require.resolve contract)', () => {
    expect(entryUrl(fixtureDir, 'package.json')?.href).toBe(new URL('./package.json', `file://${fixtureDir}`).href)
  })

  it('returns undefined for a missing package.json probe (subpath rows are not typert contributors)', () => {
    expect(entryUrl(fixtureDir, 'startup/package.json')).toBeUndefined()
  })

  it('falls back to main when the package has no exports map', () => {
    const legacyDir = fileURLToPath(new URL('./fixtures/pkg-legacy/', import.meta.url))
    expect(entryUrl(legacyDir, '')?.href).toBe(new URL('./lib/legacy.js', `file://${legacyDir}`).href)
  })
})
