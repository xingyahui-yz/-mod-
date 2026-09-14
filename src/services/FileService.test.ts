import { describe, expect, it, vi } from 'vitest'
import { appendNode, connect, createEmptyGraph } from '../node-editor/graph'
import { serializeCardDocument, type CardDocument } from '../card/cardDocument'
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
    linkNoReplace: vi.fn().mockResolvedValue({ status: 'linked' }),
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

  it('同一项目同一 Card 的原子保存严格串行，后发写入不会抢先', async () => {
    const api = electronApi()
    const firstWrite = deferred<boolean>()
    vi.mocked(api.writeFile)
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(true)
    const service = createFileService({ api })
    const base = cardDocument('Fireball', '火球')
    const latest = cardDocument('Fireball', '最终火球')

    const first = service.saveCardDocument('/project', base)
    const second = service.saveCardDocument('/project', latest)

    await vi.waitFor(() => expect(api.writeFile).toHaveBeenCalledTimes(1))
    firstWrite.resolve(true)
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
    expect(api.writeFile).toHaveBeenCalledTimes(2)
    expect(vi.mocked(api.writeFile).mock.calls[1]?.[1]).toContain('最终火球')
  })

  it('创建 Card 使用 fail-if-exists 原语并与同 ID 写入共用串行队列', async () => {
    const api = electronApi()
    vi.mocked(api.linkNoReplace!).mockResolvedValue({ status: 'exists' })
    const service = createFileService({ api })

    await expect(service.createCardDocument('/project', cardDocument('Fireball', '火球')))
      .resolves.toEqual({ ok: false, error: 'Card ID 已被占用（大小写不敏感）' })

    expect(api.linkNoReplace).toHaveBeenCalledWith(
      expect.stringMatching(/^\/project\/\.modstudio\/cards\/Fireball\.json\.tmp-/),
      '/project/.modstudio/cards/.id-claims/fireball.claim',
    )
    expect(api.rename).not.toHaveBeenCalled()
    expect(api.remove).toHaveBeenCalledWith(expect.stringMatching(/Fireball\.json\.tmp-/))
  })

  it('生成期间 Card 语义变化时不把旧源文档的指纹写回', async () => {
    const api = electronApi()
    const base = cardDocument('Fireball', '火球')
    const edited = cardDocument('Fireball', '生成期间已编辑')
    let artifactReads = 0
    vi.mocked(api.readDirectory).mockImplementation(async path => path === '/project/.modstudio/cards'
      ? [{ name: 'Fireball.json', path: '/project/.modstudio/cards/Fireball.json', isDirectory: false }]
      : [])
    vi.mocked(api.readFile).mockImplementation(async path => {
      if (path.endsWith('/Fireball.json')) return serializeCardDocument(edited)
      if (path.endsWith('/Fireball.cs')) return artifactReads++ === 0 ? null : 'generated artifact'
      return null
    })
    const service = createFileService({ api })

    await expect(service.generateCardArtifact('/project', base)).resolves.toEqual({
      status: 'failed',
      reason: 'C# 已生成，但 CardDocument 指纹写回失败',
    })
    expect(vi.mocked(api.writeFile).mock.calls.some(([path]) =>
      path.startsWith('/project/.modstudio/cards/Fireball.json.tmp-'))).toBe(false)
  })
})

function cardDocument(id: string, name: string): CardDocument {
  const trigger = appendNode(createEmptyGraph(id, 'card'), 'trigger', { x: 0, y: 0 }, { event: 'onPlay' })
  const effect = appendNode(trigger.graph, 'effect', { x: 200, y: 0 }, { kind: 'drawCards', amount: 1 })
  const linked = connect(effect.graph, { nodeId: trigger.node.id, port: 'out' }, { nodeId: effect.node.id, port: 'in' })
  return {
    schemaVersion: 2,
    card: { id, name, cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] },
    graph: linked.ok ? linked.graph : effect.graph,
    generation: { lastGeneratedFingerprint: null },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(next => { resolve = next })
  return { promise, resolve }
}
