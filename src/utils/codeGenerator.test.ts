/**
 * codeGenerator 测试
 */
import { describe, it, expect } from 'vitest'
import { generateCardCode } from './codeGenerator'
import { CardData } from '../types'

const baseCard: CardData = {
  id: 'Fireball',
  name: 'Fireball',
  cost: 1,
  type: 'Attack',
  rarity: 'Common',
  description: 'Deal 6 damage',
  keywords: ['Fire', 'Damage']
}

describe('generateCardCode', () => {
  it('应该生成包含类定义的代码', () => {
    const code = generateCardCode(baseCard)
    expect(code).toContain('public class')
    expect(code).toContain('Fireball')
  })

  it('应该包含所有卡牌属性', () => {
    const code = generateCardCode(baseCard)
    expect(code).toContain('Name = "Fireball"')
    expect(code).toContain('Cost = 1')
    expect(code).toContain('CardType.Attack')
    expect(code).toContain('CardRarity.Common')
    expect(code).toContain('Deal 6 damage')
  })

  it('应该包含关键词', () => {
    const code = generateCardCode(baseCard)
    expect(code).toContain('Keywords.Add("Fire")')
    expect(code).toContain('Keywords.Add("Damage")')
  })

  it('应该使用自定义命名空间', () => {
    const code = generateCardCode(baseCard, 'MyAwesomeMod.Cards')
    expect(code).toContain('namespace MyAwesomeMod.Cards')
  })

  it('空关键词不应生成Keywords.Add行', () => {
    const code = generateCardCode({ ...baseCard, keywords: [] })
    expect(code).not.toContain('Keywords.Add')
  })

  it('类名使用不可变 Card ID，而不是显示名称', () => {
    const code = generateCardCode({ ...baseCard, name: '!!!' })
    expect(code).toContain('public class Fireball')
    // 描述应保留原始字符串
    expect(code).toContain('Name = "!!!"')
  })

  it('应该生成SetDefaults方法', () => {
    const code = generateCardCode(baseCard)
    expect(code).toContain('SetDefaults()')
  })

  it('应该处理不同卡牌类型', () => {
    const types: CardData['type'][] = ['Attack', 'Skill', 'Power']
    for (const type of types) {
      const code = generateCardCode({ ...baseCard, type })
      expect(code).toContain(`CardType.${type}`)
    }
  })

  it('应该处理不同稀有度', () => {
    const rarities: CardData['rarity'][] = ['Common', 'Uncommon', 'Rare']
    for (const rarity of rarities) {
      const code = generateCardCode({ ...baseCard, rarity })
      expect(code).toContain(`CardRarity.${rarity}`)
    }
  })
})
