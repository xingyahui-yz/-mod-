/**
 * 卡牌导入导出工具
 */
import { CardData } from '../types'
import { parseCardData } from '../card/cardValidation'

const FORMAT_VERSION = '1.0'

export interface ExportData {
  format: 'mod-studio-cards'
  version: string
  exportedAt: string
  cards: CardData[]
}

/**
 * 导出卡牌为JSON
 */
export function exportCards(cards: CardData[]): string {
  const data: ExportData = {
    format: 'mod-studio-cards',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    cards
  }
  return JSON.stringify(data, null, 2)
}

/**
 * 从JSON导入卡牌
 */
export function importCards(jsonStr: string): { success: boolean; cards: CardData[]; error?: string } {
  try {
    const data = JSON.parse(jsonStr)

    // 验证格式
    if (!data || typeof data !== 'object') {
      return { success: false, cards: [], error: '无效的JSON格式' }
    }

    // 接受两种格式：完整格式或直接卡牌数组
    let cards: any[] = []
    if (data.format === 'mod-studio-cards' && Array.isArray(data.cards)) {
      cards = data.cards
    } else if (Array.isArray(data)) {
      cards = data
    } else {
      return { success: false, cards: [], error: '无法识别的卡牌数据格式' }
    }

    // 统一解析和过滤卡牌；返回值已经是完整的 CardData
    const validCards = cards.flatMap(card => {
      const parsed = parseCardData(card)
      return parsed ? [parsed] : []
    })
    if (validCards.length === 0) {
      return { success: false, cards: [], error: '没有有效的卡牌数据' }
    }

    return { success: true, cards: validCards }
  } catch (err) {
    return { success: false, cards: [], error: `解析失败: ${err}` }
  }
}

/**
 * 生成文件名
 */
export function generateExportFilename(): string {
  const now = new Date()
  const date = now.toISOString().split('T')[0]
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '-')
  return `mod-studio-cards-${date}-${time}.json`
}