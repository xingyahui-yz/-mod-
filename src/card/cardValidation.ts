import { CardData } from '../types'

const CARD_TYPES = ['Attack', 'Skill', 'Power'] as const
const CARD_RARITIES = ['Common', 'Uncommon', 'Rare'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCardType(value: unknown): value is CardData['type'] {
  return typeof value === 'string' && CARD_TYPES.includes(value as CardData['type'])
}

function isCardRarity(value: unknown): value is CardData['rarity'] {
  return typeof value === 'string' && CARD_RARITIES.includes(value as CardData['rarity'])
}

/**
 * 将外部数据解析为完整的 CardData。
 *
 * 所有外部输入（JSON、LLM 响应和代码解析结果）都经过这里，
 * 调用方不需要重复维护 CardData 的字段、枚举和默认关键词规则。
 */
export function parseCardData(value: unknown): CardData | null {
  if (!isRecord(value)) return null

  const { name, cost, type, rarity, description, keywords, imagePath } = value

  if (
    typeof name !== 'string' ||
    typeof cost !== 'number' ||
    !Number.isFinite(cost) ||
    cost < 0 ||
    cost > 99 ||
    !isCardType(type) ||
    !isCardRarity(rarity) ||
    typeof description !== 'string'
  ) {
    return null
  }

  // LLM 输出历史上允许省略 keywords；在 seam 处统一补成完整字段。
  const normalizedKeywords = keywords === undefined ? [] : keywords
  if (
    !Array.isArray(normalizedKeywords) ||
    !normalizedKeywords.every(keyword => typeof keyword === 'string')
  ) {
    return null
  }

  if (imagePath !== undefined && typeof imagePath !== 'string') {
    return null
  }

  const card: CardData = {
    name,
    cost,
    type,
    rarity,
    description,
    keywords: normalizedKeywords
  }

  if (imagePath !== undefined) {
    card.imagePath = imagePath
  }

  return card
}

/**
 * 编辑器保存/预览前的用户可读校验。
 * 结构校验由 parseCardData 负责，这里只保留编辑器的业务约束和错误文案。
 */
export function validateCard(card: Partial<CardData>): string[] {
  const errors: string[] = []

  if (!card.name?.trim()) {
    errors.push('卡牌名称不能为空')
  }

  if (card.name && card.name.length > 50) {
    errors.push('卡牌名称过长（最大50字符）')
  }

  if (
    card.cost === undefined ||
    !Number.isFinite(card.cost) ||
    card.cost < 0 ||
    card.cost > 99
  ) {
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
