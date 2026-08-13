import { CardData } from '../types'
import { parseCardData } from '../card/cardValidation'

/**
 * 从C#代码中解析卡牌数据
 */
export function parseCardFromCode(code: string): CardData | null {
  const result: Partial<CardData> = {}

  // 旧 C# 解析仅作为兼容 seam：优先读取 class 标识，不把 C# 作为 CardDocument 加载路径。
  const classMatch = code.match(/\bclass\s+([A-Za-z][A-Za-z0-9]*)\b/)
  if (classMatch) result.id = classMatch[1]

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

  // 只有当解析到Name时才返回有效结果；统一 seam 补齐并校验 CardData。
  const name = result.name
  if (!name) return null

  return parseCardData({
    id: result.id,
    name,
    cost: result.cost ?? 0,
    type: result.type ?? 'Attack',
    rarity: result.rarity ?? 'Common',
    description: result.description ?? '',
    keywords: result.keywords ?? []
  })
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
          if (parsed) cards.push(parsed)
        }
      }
    }
  } catch (error) {
    console.error('Error scanning cards:', error)
  }

  return cards
}
