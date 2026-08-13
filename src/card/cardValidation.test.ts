import { describe, expect, it } from 'vitest'
import { parseCardData, validateCard, isValidCardId, suggestCardId } from './cardValidation'

describe('cardValidation', () => {
  it('将合法外部数据解析为完整 CardData', () => {
    expect(parseCardData({
      id: 'HuoQiuShu',
      name: '火球术',
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '造成6点伤害。',
      keywords: ['Fire']
    })).toEqual({
      id: 'HuoQiuShu',
      name: '火球术',
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '造成6点伤害。',
      keywords: ['Fire']
    })
  })

  it('严格校验 PascalCase ASCII ID，并为中文名称要求显式确认', () => {
    expect(isValidCardId('Fireball')).toBe(true)
    expect(isValidCardId('F2')).toBe(true)
    expect(isValidCardId('fireball')).toBe(false)
    expect(isValidCardId('Fire_Ball')).toBe(false)
    expect(isValidCardId('火球')).toBe(false)
    expect(suggestCardId('fire-ball')).toBe('FireBall')
    expect(suggestCardId('火球术')).toBeNull()
    expect(parseCardData({ name: '火球术', cost: 1, type: 'Attack', rarity: 'Common', description: '', keywords: [] })?.id).toBe('')
  })

  it('省略 keywords 时在 seam 处补为空数组', () => {
    expect(parseCardData({
      name: '防御',
      cost: 1,
      type: 'Skill',
      rarity: 'Common',
      description: '获得5点格挡。'
    })?.keywords).toEqual([])
  })

  it('拒绝字段类型、枚举和费用范围错误的数据', () => {
    expect(parseCardData({
      name: '错误',
      cost: -1,
      type: 'Attack',
      rarity: 'Common',
      description: '',
      keywords: []
    })).toBeNull()
    expect(parseCardData({
      name: '错误',
      cost: 1,
      type: 'Unknown',
      rarity: 'Common',
      description: '',
      keywords: []
    })).toBeNull()
    expect(parseCardData({
      name: '错误',
      cost: 1,
      type: 'Attack',
      rarity: 'Common',
      description: '',
      keywords: [1]
    })).toBeNull()
  })

  it('保留可选 imagePath', () => {
    expect(parseCardData({
      name: '图卡',
      cost: 0,
      type: 'Power',
      rarity: 'Rare',
      description: '描述',
      keywords: [],
      imagePath: '/tmp/card.png'
    })?.imagePath).toBe('/tmp/card.png')
  })

  it('保留编辑器业务校验的错误文案', () => {
    expect(validateCard({ name: '', cost: -1, description: '' })).toEqual([
      '卡牌名称不能为空',
      '费用必须在0-99之间',
      '卡牌描述不能为空'
    ])
  })
})
