import { CardData } from '../types'

/**
 * 从C#代码中解析卡牌数据
 */
export function parseCardFromCode(code: string): Partial<CardData> | null {
  const result: Partial<CardData> = {}

  // 解析Name
  const nameMatch = code.match(/Name\s*=\s*"([^"]+)"/)
  if (nameMatch) {
    result.name = nameMatch[1]
  }

  // 解析Cost
  const costMatch = code.match(/Cost\s*=\s*(\d+)/)
  if (costMatch) {
    result.cost = parseInt(costMatch[1])
  }

  // 解析Type
  const typeMatch = code.match(/Type\s*=\s*CardType\.(\w+)/)
  if (typeMatch) {
    const typeMap: Record<string, CardData['type']> = {
      'Attack': 'Attack',
      'Skill': 'Skill',
      'Power': 'Power'
    }
    result.type = typeMap[typeMatch[1]] || 'Attack'
  }

  // 解析Rarity
  const rarityMatch = code.match(/Rarity\s*=\s*CardRarity\.(\w+)/)
  if (rarityMatch) {
    const rarityMap: Record<string, CardData['rarity']> = {
      'Common': 'Common',
      'Uncommon': 'Uncommon',
      'Rare': 'Rare'
    }
    result.rarity = rarityMap[rarityMatch[1]] || 'Common'
  }

  // 解析Description
  const descMatch = code.match(/Description\s*=\s*"([^"]+)"/)
  if (descMatch) {
    result.description = descMatch[1]
  }

  // 解析Keywords
  const keywords: string[] = []
  const keywordMatches = code.matchAll(/Keywords\.Add\(\s*"([^"]+)"\s*\)/g)
  for (const match of keywordMatches) {
    keywords.push(match[1])
  }
  if (keywords.length > 0) {
    result.keywords = keywords
  }

  // 只有当解析到Name时才返回有效结果
  return result.name ? result : null
}

/**
 * 从目录中扫描所有卡牌
 */
export async function scanCardsFromDirectory(
  dirPath: string,
  readFile: (path: string) => Promise<string | null>
): Promise<CardData[]> {
  const cards: CardData[] = []

  try {
    const entries = await window.electronAPI.readDirectory(dirPath)

    for (const entry of entries) {
      if (!entry.isDirectory && entry.name.endsWith('.cs')) {
        const content = await readFile(entry.path)
        if (content) {
          const parsed = parseCardFromCode(content)
          if (parsed && parsed.name) {
            cards.push({
              name: parsed.name || 'Unknown',
              cost: parsed.cost || 0,
              type: parsed.type || 'Attack',
              rarity: parsed.rarity || 'Common',
              description: parsed.description || '',
              keywords: parsed.keywords || []
            })
          }
        }
      }
    }
  } catch (error) {
    console.error('Error scanning cards:', error)
  }

  return cards
}

/**
 * 验证卡牌数据
 */
export function validateCard(card: Partial<CardData>): string[] {
  const errors: string[] = []

  if (!card.name?.trim()) {
    errors.push('卡牌名称不能为空')
  }

  if (card.name && card.name.length > 50) {
    errors.push('卡牌名称过长（最大50字符）')
  }

  if (card.cost === undefined || card.cost < 0 || card.cost > 99) {
    errors.push('费用必须在0-99之间')
  }

  if (!card.description?.trim()) {
    errors.push('卡牌描述不能为空')
  }

  if (card.description && card.description.length > 500) {
    errors.push('卡牌描述过长（最大500字符）')
  }

  return errors
}
