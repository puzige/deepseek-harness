/**
 * Unit tests for the desktop server bootstrap: patch composition decisions
 * that are pure and testable without booting a full Cordis tree.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { resolveTelemetryPatch, localWebUrl } from '../src/main/server.ts'

afterEach(() => { vi.restoreAllMocks() })

describe('resolveTelemetryPatch', () => {
  it('returns undefined when the switch is unset or empty', () => {
    expect(resolveTelemetryPatch(undefined, true)).toBeUndefined()
    expect(resolveTelemetryPatch('', true)).toBeUndefined()
  })

  it('disables the telemetry row for ANY non-empty value (privacy switch)', () => {
    expect(resolveTelemetryPatch('1', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('false', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
    expect(resolveTelemetryPatch('0', true)).toEqual({ id: 'session-telemetry-otel', disabled: true })
  })

  it('returns undefined when the composition has no telemetry row', () => {
    expect(resolveTelemetryPatch('1', false)).toBeUndefined()
  })
})

describe('localWebUrl', () => {
  it('renders the loopback URL from the bound server port', () => {
    expect(localWebUrl(64430)).toBe('http://127.0.0.1:64430')
  })

  it('renders port 0 and large ports without decoration', () => {
    expect(localWebUrl(0)).toBe('http://127.0.0.1:0')
    expect(localWebUrl(65535)).toBe('http://127.0.0.1:65535')
  })
})
