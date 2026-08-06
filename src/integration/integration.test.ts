/**
 * 端到端功能完整性测试
 * 覆盖关键用户路径：保存→解析往返、Mustache 模板、HTTP 适配器、FileService、卡牌导入导出
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateCardCode } from '../utils/codeGenerator'
import { parseCardFromCode } from '../utils/cardParser'
import { validateCard } from '../card/cardValidation'
import { exportCards, importCards } from '../utils/cardIO'
import { HTTPAdapter, PROVIDER_CONFIGS } from '../services/llm/adapters/httpAdapter'
import * as FileService from '../services/FileService'
import { CardData } from '../types'

const sampleCard: CardData = {
  name: '火球术',
  cost: 1,
  type: 'Attack',
  rarity: 'Common',
  description: '造成6点伤害。',
  keywords: ['Fire', 'Damage']
}

describe('1. 卡牌 → C#代码 → 卡牌 往返', () => {
  it('完整往返不丢失字段', () => {
    const code = generateCardCode(sampleCard, 'MyMod.Cards')
    const parsed = parseCardFromCode(code)

    expect(parsed).not.toBeNull()
    expect(parsed!.name).toBe(sampleCard.name)
    expect(parsed!.cost).toBe(sampleCard.cost)
    expect(parsed!.type).toBe(sampleCard.type)
    expect(parsed!.rarity).toBe(sampleCard.rarity)
    expect(parsed!.description).toBe(sampleCard.description)
    expect(parsed!.keywords).toEqual(sampleCard.keywords)
  })

  it('生成的代码包含 namespace、class、特性', () => {
    const code = generateCardCode(sampleCard, 'MyMod.Cards')
    expect(code).toContain('namespace MyMod.Cards')
    expect(code).toMatch(/class MyCard\b/)  // 中文名→空→回退 MyCard
    expect(code).toContain('Name = "火球术"')
    expect(code).toContain('Cost = 1')
    expect(code).toContain('CardType.Attack')
    expect(code).toContain('CardRarity.Common')
    expect(code).toContain('Keywords.Add("Fire")')
    expect(code).toContain('Keywords.Add("Damage")')
  })

  it('类名通过 PascalCase 转换（英文输入）', () => {
    // fire-ball → Fireball（实现：分隔符吃掉第一个字符，仅后续字符大写）
    expect(generateCardCode({ ...sampleCard, name: 'fire-ball' }, 'X').match(/class (\w+)/)![1])
      .toBe('Fireball')
    expect(generateCardCode({ ...sampleCard, name: 'defend' }, 'X').match(/class (\w+)/)![1])
      .toBe('Defend')
  })

  it('空名称回退到 MyCard', () => {
    const code = generateCardCode({ ...sampleCard, name: '' }, 'X')
    expect(code).toContain('class MyCard')
  })
})

describe('2. 卡牌验证', () => {
  it('合法卡牌无错误', () => {
    expect(validateCard(sampleCard)).toEqual([])
  })

  it('空名称报错', () => {
    expect(validateCard({ ...sampleCard, name: '' })).toContain('卡牌名称不能为空')
    expect(validateCard({ ...sampleCard, name: '   ' })).toContain('卡牌名称不能为空')
  })

  it('名称过长报错', () => {
    expect(validateCard({ ...sampleCard, name: 'x'.repeat(51) })).toContain('卡牌名称过长（最大50字符）')
  })

  it('费用越界报错（负数/超99）', () => {
    expect(validateCard({ ...sampleCard, cost: -1 })).toContain('费用必须在0-99之间')
    expect(validateCard({ ...sampleCard, cost: 100 })).toContain('费用必须在0-99之间')
  })

  it('空描述报错', () => {
    expect(validateCard({ ...sampleCard, description: '' })).toContain('卡牌描述不能为空')
  })

  it('边界值合法（费用 0/99、名称 50 字符）', () => {
    expect(validateCard({ ...sampleCard, cost: 0 })).toEqual([])
    expect(validateCard({ ...sampleCard, cost: 99 })).toEqual([])
    expect(validateCard({ ...sampleCard, name: 'x'.repeat(50) })).toEqual([])
  })
})

describe('3. 导入/导出 JSON 往返', () => {
  it('导出 → 导入 完整往返', () => {
    const json = exportCards([sampleCard, { ...sampleCard, name: '冰刺', cost: 2 }])
    const result = importCards(json)

    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0].name).toBe('火球术')
    expect(result.cards[1].name).toBe('冰刺')
    expect(result.cards[1].cost).toBe(2)
  })

  it('接受简化的卡牌数组格式', () => {
    const result = importCards(JSON.stringify([sampleCard]))
    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(1)
  })

  it('拒绝格式错误的 JSON', () => {
    expect(importCards('not json').success).toBe(false)
    expect(importCards('{}').error).toMatch(/无法识别/)
    expect(importCards('{"format":"wrong"}').error).toMatch(/无法识别/)
  })

  it('拒绝类型/稀有度无效的卡牌', () => {
    const bad = [{ ...sampleCard, type: 'Weapon' as any }]
    const result = importCards(JSON.stringify(bad))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/没有有效/)
  })

  it('混合有效/无效时只返回有效卡牌', () => {
    const mixed = [
      sampleCard,
      { ...sampleCard, name: '', cost: 'x' as any }  // 无效
    ]
    const result = importCards(JSON.stringify(mixed))
    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(1)
  })
})

describe('4. HTTP LLM 适配器', () => {
  let fetchSpy: any

  beforeEach(() => {
    fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('正确配置四个提供商', () => {
    expect(PROVIDER_CONFIGS.minimax.name).toBe('MiniMax')
    expect(PROVIDER_CONFIGS.qwen.baseUrl).toContain('aliyuncs.com')
    expect(PROVIDER_CONFIGS.ernie.name).toBe('文心一言')
    expect(PROVIDER_CONFIGS.chatglm.name).toBe('ChatGLM')
  })

  it('调用 fetch 携带正确的 endpoint / header / body', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[]' } }]
      })
    })

    const adapter = new HTTPAdapter('qwen', { apiKey: 'test-key-123' })
    await adapter.generate('hello')

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]

    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer test-key-123')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(init.body)
    expect(body.model).toBe('qwen-turbo')
    expect(body.messages[0].content).toBe('hello')
    expect(body.temperature).toBe(0.7)
  })

  it('解析 OpenAI 格式响应 → 提取 content', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[{"name":"火焰","cost":1,"type":"Attack","rarity":"Common","description":"a","keywords":[]}]' } }]
      })
    })

    const adapter = new HTTPAdapter('qwen', { apiKey: 'k' })
    const result = await adapter.generateCards('造一张火焰牌')

    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].name).toBe('火焰')
  })

  it('HTTP 错误返回错误信息', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key' } })
    })

    const adapter = new HTTPAdapter('minimax', { apiKey: 'bad' })
    const result = await adapter.generate('x')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid API Key')
  })

  it('未知提供商回退到 minimax', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] })
    })
    const adapter = new HTTPAdapter('unknown-provider', { apiKey: 'k' })
    await adapter.generate('x')

    const url = fetchSpy.mock.calls[0][0]
    expect(url).toContain('api.minimax.chat')
  })

  it('LLM 返回非 JSON 时 generateCards 报告失败', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '抱歉，我无法生成卡牌' } }] })
    })

    const adapter = new HTTPAdapter('qwen', { apiKey: 'k' })
    const result = await adapter.generateCards('测试')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/无法解析/)
  })
})

describe('5. FileService 文件系统（依赖注入）', () => {
  beforeEach(() => {
    // 重置 API（每个测试用 mock 重新注入）
  })

  it('loadCardsFromProject 扫描 scripts/Cards 目录下的 .cs 文件', async () => {
    const mockCode = generateCardCode(sampleCard, 'MyMod.Cards')
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(),
      saveDirectory: vi.fn(),
      readDirectory: vi.fn().mockResolvedValue([
        { name: 'Fireball.cs', isDirectory: false, path: '/proj/scripts/Cards/Fireball.cs' },
        { name: 'README.txt', isDirectory: false, path: '/proj/scripts/Cards/README.txt' },
        { name: 'subdir', isDirectory: true, path: '/proj/scripts/Cards/subdir' }
      ]),
      readFile: vi.fn().mockResolvedValue(mockCode),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      copyDirectory: vi.fn(),
      getUserDataPath: vi.fn(),
      launchGame: vi.fn(),
      showInFolder: vi.fn()
    }
    FileService.setApi(mockApi)

    const cards = await FileService.loadCardsFromProject('/proj')

    expect(mockApi.readDirectory).toHaveBeenCalledWith('/proj/scripts/Cards')
    expect(cards).toHaveLength(1) // 只 Fireball.cs 通过
    expect(cards[0].name).toBe('火球术')
  })

  it('saveCardToProject 生成 PascalCase 文件名并写入', async () => {
    const writeFile = vi.fn().mockResolvedValue(true)
    const mkdir = vi.fn().mockResolvedValue(true)
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn(), readFile: vi.fn(),
      writeFile, mkdir,
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    FileService.setApi(mockApi)

    // 用英文名确保 PascalCase 转换产出有意义类名
    const englishCard: CardData = { ...sampleCard, name: 'fireball' }
    const result = await FileService.saveCardToProject('/proj', englishCard)

    expect(result.success).toBe(true)
    expect(result.fileName).toBe('Fireball.cs')
    expect(mkdir).toHaveBeenCalledWith('/proj/scripts/Cards')
    expect(writeFile).toHaveBeenCalledOnce()
    const [path, content] = writeFile.mock.calls[0]
    expect(path).toBe('/proj/scripts/Cards/Fireball.cs')
    expect(content).toContain('class Fireball')
  })

  it('中文名保存时回退到 MyCard.cs', async () => {
    const writeFile = vi.fn().mockResolvedValue(true)
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn(), readFile: vi.fn(),
      writeFile, mkdir: vi.fn(),
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    FileService.setApi(mockApi)

    const result = await FileService.saveCardToProject('/proj', sampleCard)  // '火球术'

    expect(result.fileName).toBe('MyCard.cs')
  })

  it('loadModManifest 支持多种 manifest 文件名', async () => {
    const readFile = vi.fn()
      .mockResolvedValueOnce(null)  // mod_manifest.json 不存在
      .mockResolvedValueOnce(null)  // ModTheSpire.json 不存在
      .mockResolvedValueOnce(JSON.stringify({ id: 'x', name: 'MyMod', version: '1.0', authors: ['me'], description: '', dependencies: [] }))

    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn(), readFile,
      writeFile: vi.fn(), mkdir: vi.fn(),
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    FileService.setApi(mockApi)

    const manifest = await FileService.loadModManifest('/proj')

    expect(manifest).not.toBeNull()
    expect(manifest!.name).toBe('MyMod')
    expect(readFile).toHaveBeenCalledTimes(3)
  })

  it('getProjectFiles 排序：目录在前，文件在后，名称字典序', async () => {
    const mockApi: FileService.ElectronAPI = {
      openDirectory: vi.fn(), saveDirectory: vi.fn(),
      readDirectory: vi.fn().mockResolvedValue([
        { name: 'zeta.txt', isDirectory: false, path: '/a' },
        { name: 'alpha', isDirectory: true, path: '/b' },
        { name: 'beta.txt', isDirectory: false, path: '/c' },
        { name: 'Alpha', isDirectory: true, path: '/d' }
      ]),
      readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(),
      copyDirectory: vi.fn(), getUserDataPath: vi.fn(),
      launchGame: vi.fn(), showInFolder: vi.fn()
    }
    FileService.setApi(mockApi)

    const sorted = await FileService.getProjectFiles('/x')

    // 目录排前，文件排后；同类型内按名称排序
    // （注意：localeCompare 默认不分大小写，alpha < Alpha）
    expect(sorted.map(e => e.name)).toEqual(['alpha', 'Alpha', 'beta.txt', 'zeta.txt'])
  })
})