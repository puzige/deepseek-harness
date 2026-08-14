/**
 * Unit tests for the menu: the macOS branch hides the system bar and re-binds
 * accelerators; other platforms keep the in-window menu.
 */
import { describe, expect, it, vi } from 'vitest'
import * as menu from '../src/main/menu.ts'

/** A minimal fake window whose webContents records the roles the handler invokes. */
function fakeWindow(): {
  webContents: {
    on: ReturnType<typeof vi.fn>
    copy: ReturnType<typeof vi.fn>
    cut: ReturnType<typeof vi.fn>
    paste: ReturnType<typeof vi.fn>
    selectAll: ReturnType<typeof vi.fn>
    undo: ReturnType<typeof vi.fn>
    redo: ReturnType<typeof vi.fn>
    reload: ReturnType<typeof vi.fn>
    reloadIgnoringCache: ReturnType<typeof vi.fn>
    toggleDevTools: ReturnType<typeof vi.fn>
    getZoomLevel: ReturnType<typeof vi.fn>
    setZoomLevel: ReturnType<typeof vi.fn>
  }
} {
  return {
    webContents: {
      on: vi.fn(),
      copy: vi.fn(),
      cut: vi.fn(),
      paste: vi.fn(),
      selectAll: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
      toggleDevTools: vi.fn(),
      getZoomLevel: vi.fn(() => 0),
      setZoomLevel: vi.fn(),
    },
  }
}

/** Run the registered before-input-event handler with a synthetic key event. */
function fireKey(win: ReturnType<typeof fakeWindow>, event: {
  meta?: boolean
  control?: boolean
  type?: string
  key: string
  shift?: boolean
}): void {
  const listener = (win.webContents.on.mock.calls as unknown[][])
    .find(([name]) => name === 'before-input-event')?.[1] as ((event: unknown, input: unknown) => void) | undefined
  if (listener === undefined) throw new Error('no before-input-event listener registered')
  listener({ preventDefault: vi.fn() }, {
    meta: event.meta ?? false,
    control: event.control ?? false,
    type: event.type ?? 'keyDown',
    key: event.key,
    shift: event.shift ?? false,
  })
}

describe('menu', () => {
  it('exposes installAcceleratorHandler and createMenu', () => {
    expect(typeof menu.installAcceleratorHandler).toBe('function')
    expect(typeof menu.createMenu).toBe('function')
  })

  it('registers a before-input-event listener on the window', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    expect(win.webContents.on).toHaveBeenCalledWith('before-input-event', expect.any(Function))
  })

  it('re-binds Cmd+C to copy through the handler', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    fireKey(win, { meta: true, key: 'c' })
    expect(win.webContents.copy).toHaveBeenCalledTimes(1)
  })

  it('re-binds Cmd+Shift+R to reloadIgnoringCache and Cmd+R to reload', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    fireKey(win, { meta: true, shift: true, key: 'r' })
    expect(win.webContents.reloadIgnoringCache).toHaveBeenCalledTimes(1)
    fireKey(win, { meta: true, key: 'r' })
    expect(win.webContents.reload).toHaveBeenCalledTimes(1)
  })

  it('re-binds Cmd+Shift+I to toggleDevTools', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    fireKey(win, { meta: true, shift: true, key: 'i' })
    expect(win.webContents.toggleDevTools).toHaveBeenCalledTimes(1)
  })

  it('ignores plain keys without a modifier', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    fireKey(win, { key: 'c' })
    expect(win.webContents.copy).not.toHaveBeenCalled()
  })

  it('ignores unbound command keys', () => {
    const win = fakeWindow()
    menu.installAcceleratorHandler(win as never)
    fireKey(win, { meta: true, key: 'q' })
    expect(win.webContents.copy).not.toHaveBeenCalled()
    expect(win.webContents.cut).not.toHaveBeenCalled()
  })
})
