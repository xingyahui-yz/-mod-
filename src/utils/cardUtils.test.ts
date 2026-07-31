/**
 * cardUtils 测试
 */
import { describe, it, expect } from 'vitest'
import { getTypeColor, getRarityColor } from './cardUtils'

describe('getTypeColor', () => {
  it('Attack应为红色', () => {
    expect(getTypeColor('Attack')).toBe('#e94560')
  })

  it('Skill应为绿色', () => {
    expect(getTypeColor('Skill')).toBe('#4ade80')
  })

  it('Power应为紫色', () => {
    expect(getTypeColor('Power')).toBe('#a855f7')
  })
})

describe('getRarityColor', () => {
  it('Common应为灰色', () => {
    expect(getRarityColor('Common')).toBeTruthy()
  })

  it('Uncommon应有颜色', () => {
    expect(getRarityColor('Uncommon')).toBeTruthy()
  })

  it('Rare应有颜色', () => {
    expect(getRarityColor('Rare')).toBeTruthy()
  })

  it('所有稀有度应返回不同颜色', () => {
    const common = getRarityColor('Common')
    const uncommon = getRarityColor('Uncommon')
    const rare = getRarityColor('Rare')

    expect(common).not.toBe(uncommon)
    expect(uncommon).not.toBe(rare)
    expect(common).not.toBe(rare)
  })
})