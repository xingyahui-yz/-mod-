/**
 * cardIO 工具测试
 */
import { describe, it, expect } from 'vitest'
import { exportCards, importCards, generateExportFilename } from './cardIO'
import { CardData } from '../types'

const testCards: CardData[] = [
  {
    name: 'Fireball',
    cost: 1,
    type: 'Attack',
    rarity: 'Common',
    description: 'Deal 6 damage',
    keywords: ['Fire', 'Damage']
  },
  {
    name: 'Shield',
    cost: 1,
    type: 'Skill',
    rarity: 'Common',
    description: 'Gain 5 Block',
    keywords: ['Block']
  }
]

describe('exportCards', () => {
  it('应该生成包含元数据的JSON', () => {
    const json = exportCards(testCards)
    const parsed = JSON.parse(json)

    expect(parsed.format).toBe('mod-studio-cards')
    expect(parsed.version).toBeTruthy()
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.cards).toHaveLength(2)
  })

  it('空卡牌数组应该导出为空数组', () => {
    const json = exportCards([])
    const parsed = JSON.parse(json)
    expect(parsed.cards).toEqual([])
  })

  it('应该保留所有卡牌数据', () => {
    const json = exportCards(testCards)
    const parsed = JSON.parse(json)
    expect(parsed.cards[0].name).toBe('Fireball')
    expect(parsed.cards[0].cost).toBe(1)
    expect(parsed.cards[0].keywords).toEqual(['Fire', 'Damage'])
  })
})

describe('importCards', () => {
  it('应该导入有效的JSON', () => {
    const json = exportCards(testCards)
    const result = importCards(json)

    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0].name).toBe('Fireball')
  })

  it('应该接受直接卡牌数组格式', () => {
    const arrayJson = JSON.stringify(testCards)
    const result = importCards(arrayJson)

    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(2)
  })

  it('应该拒绝无效JSON', () => {
    const result = importCards('not json{')

    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.cards).toEqual([])
  })

  it('应该拒绝无效格式', () => {
    const result = importCards(JSON.stringify({ wrong: 'format' }))

    expect(result.success).toBe(false)
    expect(result.error).toContain('无法识别')
  })

  it('应该过滤掉无效卡牌', () => {
    const mixed = JSON.stringify([
      testCards[0],
      { invalid: 'card' },
      { name: 'X', cost: 1, type: 'Wrong', rarity: 'Common', description: '', keywords: [] }
    ])
    const result = importCards(mixed)

    expect(result.success).toBe(true)
    expect(result.cards).toHaveLength(1)
  })

  it('空数组应该返回无有效卡牌错误', () => {
    const result = importCards(JSON.stringify([]))

    expect(result.success).toBe(false)
    expect(result.error).toContain('没有有效的卡牌数据')
  })
})

describe('generateExportFilename', () => {
  it('应该生成带日期时间的文件名', () => {
    const filename = generateExportFilename()

    expect(filename).toMatch(/^mod-studio-cards-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/)
  })

  it('每次调用应该返回不同或相同的合理文件名', () => {
    const filename1 = generateExportFilename()
    const filename2 = generateExportFilename()

    expect(filename1).toContain('mod-studio-cards-')
    expect(filename2).toContain('mod-studio-cards-')
  })
})