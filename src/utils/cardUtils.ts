/**
 * 卡牌相关工具函数
 */
import { CardData } from '../types'

/**
 * 获取卡牌类型的颜色
 */
export function getTypeColor(type: CardData['type']): string {
  switch (type) {
    case 'Attack': return '#e94560'
    case 'Skill': return '#4ade80'
    case 'Power': return '#a855f7'
    default: return '#888'
  }
}

/**
 * 获取卡牌稀有度的颜色
 */
export function getRarityColor(rarity: CardData['rarity']): string {
  switch (rarity) {
    case 'Common': return '#888888'
    case 'Uncommon': return '#4ade80'
    case 'Rare': return '#a855f7'
    default: return '#888888'
  }
}
