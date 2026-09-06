import { describe, expect, it, vi } from 'vitest'
import { createConversationFilePort, createFileService, type ElectronAPI } from './FileService'

function electronApi(): ElectronAPI {
  return {
    openDirectory: vi.fn().mockResolvedValue(null),
    saveDirectory: vi.fn().mockResolvedValue(null),
    readDirectory: vi.fn().mockResolvedValue([]),
    readDirectoryResult: vi.fn().mockResolvedValue({ status: 'found', value: [] }),
    readFile: vi.fn().mockResolvedValue(null),
    readFileResult: vi.fn().mockResolvedValue({ status: 'missing' }),
    writeFile: vi.fn().mockResolvedValue(true),
    rename: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(true),
    copyDirectory: vi.fn().mockResolvedValue(true),
    getUserDataPath: vi.fn().mockResolvedValue('/user'),
    launchGame: vi.fn().mockResolvedValue({ success: true }),
    showInFolder: vi.fn().mockResolvedValue(true),
  }
}

describe('FileService conversation port', () => {
  it('暴露 repository 所需的底层文件原语', async () => {
    const api = electronApi()
    vi.mocked(api.readDirectory).mockResolvedValue([
      { name: 'conversation.json.quarantine-1', isDirectory: false, path: '/p/.modstudio/ai/conversation.json.quarantine-1' },
    ])
    vi.mocked(api.readFile).mockResolvedValue('{}')
    vi.mocked(api.readDirectoryResult!).mockResolvedValue({
      status: 'found',
      value: [{ name: 'conversation.json.quarantine-1', isDirectory: false, path: '/p/.modstudio/ai/conversation.json.quarantine-1' }],
    })
    vi.mocked(api.readFileResult!).mockResolvedValue({ status: 'found', value: '{}' })
    const port = createConversationFilePort(createFileService({ api }))

    await expect(port.readDirectory('/p/.modstudio/ai')).resolves.toEqual({
      status: 'found',
      value: ['/p/.modstudio/ai/conversation.json.quarantine-1'],
    })
    await expect(port.readFile('/p/a')).resolves.toEqual({ status: 'found', value: '{}' })
    await expect(port.writeFile('/p/a.tmp', '{}')).resolves.toBe(true)
    await expect(port.rename('/p/a.tmp', '/p/a')).resolves.toBe(true)
    await expect(port.remove('/p/a.tmp')).resolves.toBe(true)
    await expect(port.mkdir('/p/.modstudio/ai')).resolves.toBe(true)

    expect(api.readDirectoryResult).toHaveBeenCalledWith('/p/.modstudio/ai')
    expect(api.rename).toHaveBeenCalledWith('/p/a.tmp', '/p/a')
  })

  it('typed 读取保留 missing 与 permission error 的区别', async () => {
    const api = electronApi()
    vi.mocked(api.readFileResult!).mockResolvedValue({ status: 'error', code: 'permission-denied', error: '没有权限读取该路径' })
    const service = createFileService({ api })

    await expect(service.readFileResult('/p/secret')).resolves.toEqual({
      status: 'error',
      code: 'permission-denied',
      error: '没有权限读取该路径',
    })
    expect(api.readFile).not.toHaveBeenCalled()
  })

  it('ConversationFilePort 不会把读取错误降级成 missing', async () => {
    const api = electronApi()
    vi.mocked(api.readFileResult!).mockResolvedValue({ status: 'error', code: 'permission-denied', error: 'EACCES' })
    vi.mocked(api.readDirectoryResult!).mockResolvedValue({ status: 'missing' })
    const port = createConversationFilePort(createFileService({ api }))

    await expect(port.readFile('/p/conversation.json')).resolves.toEqual({ status: 'error', error: 'EACCES' })
    await expect(port.readDirectory('/p/.modstudio/ai')).resolves.toEqual({ status: 'missing' })
  })

  it('ConversationFilePort 不回退到会吞掉错误的 legacy 读取', async () => {
    const api = electronApi()
    api.readFileResult = undefined
    api.readDirectoryResult = undefined
    vi.mocked(api.readFile).mockResolvedValue('legacy-content')
    const port = createConversationFilePort(createFileService({ api }))

    await expect(port.readFile('/p/conversation.json')).resolves.toMatchObject({ status: 'error' })
    await expect(port.readDirectory('/p/.modstudio/ai')).resolves.toMatchObject({ status: 'error' })
    expect(api.readFile).not.toHaveBeenCalled()
    expect(api.readDirectory).not.toHaveBeenCalled()
  })

  it('项目文件排序不会改变底层 readDirectory 返回的数组', async () => {
    const api = electronApi()
    const raw = [
      { name: 'z.txt', isDirectory: false, path: '/p/z.txt' },
      { name: 'a', isDirectory: true, path: '/p/a' },
    ]
    vi.mocked(api.readDirectory).mockResolvedValue(raw)
    const service = createFileService({ api })

    await expect(service.getProjectFiles('/p')).resolves.toEqual([raw[1], raw[0]])
    expect(raw[0].name).toBe('z.txt')
  })
})
