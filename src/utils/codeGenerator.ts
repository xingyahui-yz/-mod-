import Mustache from 'mustache'
import { CardData } from '../types'
import cardTemplate from '../templates/card.mustache?raw'

/**
 * 生成卡牌C#代码
 */
export function generateCardCode(card: CardData, namespace: string = 'MyMod.Cards'): string {
  const className = card.id || 'MyCard'

  const view = {
    namespace,
    className,
    name: card.name,
    cost: card.cost,
    type: card.type,
    rarity: card.rarity,
    description: card.description,
    keywords: card.keywords.filter(k => k.trim() !== '')
  }

  return Mustache.render(cardTemplate, view)
}
