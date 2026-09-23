import { beforeEach, describe, expect, it, vi } from 'vitest'

type AppListener = (...args: unknown[]) => void

const harness = vi.hoisted(() => {
  function createMockWindow() {
    return {
      once: vi.fn(),
      on: vi.fn(),
      webContents: { openDevTools: vi.fn() },
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      isVisible: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    }
  }

  const state = {
    hasSingleInstanceLock: true,
    readyCallback: undefined as (() => void) | undefined,
    listeners: new Map<string, AppListener>(),
    window: undefined as ReturnType<typeof createMockWindow> | undefined,
  }

  const app = {
    requestSingleInstanceLock: vi.fn(() => state.hasSingleInstanceLock),
    quit: vi.fn(),
    getPath: vi.fn(() => '/tmp/mod-studio-test'),
    on: vi.fn((event: string, listener: AppListener) => {
      state.listeners.set(event, listener)
    }),
    whenReady: vi.fn(() => ({
      then: vi.fn((callback: () => void) => {
        state.readyCallback = callback
      }),
    })),
  }

  const BrowserWindow = vi.fn(function BrowserWindowMock() {
    const window = createMockWindow()
    state.window = window
    return window
  })

  const ipcMain = { handle: vi.fn() }
  const dialog = { showOpenDialog: vi.fn() }
  const shell = { openPath: vi.fn(), showItemInFolder: vi.fn() }

  return { state, app, BrowserWindow, ipcMain, dialog, shell }
})

vi.mock('electron', () => ({
  app: harness.app,
  BrowserWindow: harness.BrowserWindow,
  ipcMain: harness.ipcMain,
  dialog: harness.dialog,
  shell: harness.shell,
}))

describe('Electron single-instance lifecycle', () => {
  const mainModulePath = ['..', 'electron', 'main'].join('/')

  beforeEach(() => {
    vi.resetModules()
    harness.state.hasSingleInstanceLock = true
    harness.state.readyCallback = undefined
    harness.state.listeners.clear()
    harness.state.window = undefined
    vi.clearAllMocks()
  })

  it('quits without registering IPC or window lifecycle when the lock is unavailable', async () => {
    harness.state.hasSingleInstanceLock = false

    await import(/* @vite-ignore */ mainModulePath)

    expect(harness.app.requestSingleInstanceLock).toHaveBeenCalledOnce()
    expect(harness.app.quit).toHaveBeenCalledOnce()
    expect(harness.ipcMain.handle).not.toHaveBeenCalled()
    expect(harness.app.whenReady).not.toHaveBeenCalled()
    expect(harness.app.on).not.toHaveBeenCalled()
    expect(harness.BrowserWindow).not.toHaveBeenCalled()
  })

  it('registers the primary instance and restores its window on a second launch', async () => {
    await import(/* @vite-ignore */ mainModulePath)

    expect(harness.ipcMain.handle).toHaveBeenCalled()
    expect(harness.state.listeners.has('second-instance')).toBe(true)
    expect(harness.state.readyCallback).toBeTypeOf('function')

    harness.state.readyCallback?.()
    const window = harness.state.window
    expect(window).toBeDefined()

    harness.state.listeners.get('second-instance')?.()

    expect(window?.restore).toHaveBeenCalledOnce()
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledOnce()
  })
})
