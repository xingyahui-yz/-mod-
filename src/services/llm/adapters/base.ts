/**
 * LLM适配器基类接口
 * 所有模型适配器必须实现此接口
 */
import { CardData } from '../../../types'
import { parseCardData } from '../../../card/cardValidation'
import type { CardDocument } from '../../../card/cardDocument'
import { createCardProposal, type CardProposal } from '../../../card/cardAiProposal'

export interface LLMResponse {
  success: boolean
  content?: string
  error?: string
}

export interface CardGenerationResult {
  cards: CardData[]
  rawResponse?: string
  success: boolean
  error?: string
}

export interface CardProposalGenerationResult {
  success: boolean
  proposal?: CardProposal
  rawResponse?: string
  violations: string[]
  error?: string
}

export interface LLMConfig {
  apiKey: string
  baseUrl?: string
}

export abstract class BaseLLMAdapter {
  protected config: LLMConfig
  protected _modelName: string | null = null

  constructor(config: LLMConfig) {
    this.config = config
  }

  /** Lazy 访问 modelName，避免基类构造时派生类字段尚未初始化的 TS/JS 限制 */
  get modelName(): string {
    if (this._modelName === null) {
      this._modelName = this.getModelName()
    }
    return this._modelName
  }

  abstract getModelName(): string

  abstract generate(prompt: string): Promise<LLMResponse>

  /**
   * 生成卡牌
   */
  async generateCards(
    userDescription: string,
    preferredType?: CardData['type']
  ): Promise<CardGenerationResult> {
    const prompt = this.buildCardPrompt(userDescription, preferredType)

    try {
      const response = await this.generate(prompt)

      if (!response.success || !response.content) {
        return {
          cards: [],
          success: false,
          error: response.error || '生成失败'
        }
      }

      const cards = this.parseCardResponse(response.content)

      if (cards.length === 0) {
        return {
          cards: [],
          success: false,
          error: '无法解析卡牌数据，请尝试更详细的描述'
        }
      }

      return {
        cards,
        rawResponse: response.content,
        success: true
      }
    } catch (err) {
      return {
        cards: [],
        success: false,
        error: String(err)
      }
    }
  }

  /** 请求完整 CardDocument，并先转成 revision-bound 提案；不会直接写 Store。 */
  async generateCardProposal(
    baseDocument: CardDocument,
    userDescription: string,
  ): Promise<CardProposalGenerationResult> {
    if (!userDescription.trim()) {
      return { success: false, violations: ['请输入卡牌描述'], error: '请输入卡牌描述' }
    }
    try {
      const response = await this.generate(this.buildCardProposalPrompt(baseDocument, userDescription))
      if (!response.success || !response.content) {
        return { success: false, violations: [], error: response.error || '生成失败' }
      }
      let jsonText = response.content.trim()
      const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i)
      if (fenced) jsonText = fenced[1].trim()
      const candidate = JSON.parse(jsonText) as unknown
      const proposal = createCardProposal(baseDocument, candidate)
      if (proposal.status === 'invalid') {
        return { success: false, rawResponse: response.content, violations: proposal.violations, error: 'AI 提案结构校验失败' }
      }
      return { success: true, rawResponse: response.content, violations: [], proposal: proposal.proposal }
    } catch (error) {
      return { success: false, violations: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * 构建卡牌生成的Prompt
   */
  protected buildCardPrompt(
    userDescription: string,
    preferredType?: CardData['type']
  ): string {
    const typeHint = preferredType ? `${preferredType}类型` : ''
    return `你是一个杀戮尖塔2的卡牌设计师。

用户想要一张卡牌，描述如下: ${userDescription}
${typeHint ? `偏好类型: ${typeHint}` : ''}

请生成2-3个不同的卡牌选项，返回JSON格式数组，每个卡牌包含:
- name: 卡牌名称（中文）
- cost: 能量费用（数字，0-99）
- type: 卡牌类型（必须是 "Attack" | "Skill" | "Power" 之一）
- rarity: 稀有度（必须是 "Common" | "Uncommon" | "Rare" 之一）
- description: 效果描述（中文，50字以内）
- keywords: 关键词数组（如 ["Fire", "Damage"]）

只返回JSON数组，不要添加其他解释或markdown格式。
例如：[{"name":"火球术","cost":1,"type":"Attack","rarity":"Common","description":"造成6点伤害。","keywords":["Fire"]}]`
  }

  protected buildCardProposalPrompt(baseDocument: CardDocument, userDescription: string): string {
    return `你是杀戮尖塔2 Card 行为图设计师。用户想要：${userDescription}
请返回一个完整 JSON 对象，必须包含 schemaVersion=2、card、graph、generation 四个字段。
card 必须保留当前 ID ${baseDocument.card.id}，graph 必须是 entityType=card、entityId=${baseDocument.card.id} 的 NodeGraph。
只允许当前 Card registry 中的 trigger/effect kind；不要输出 markdown、解释或额外字段。generation.lastGeneratedFingerprint 必须为 null。
当前 Card 草稿：${JSON.stringify({ card: baseDocument.card, graph: baseDocument.graph })}`
  }

  /**
   * 解析LLM返回的JSON响应
   */
  protected parseCardResponse(content: string): CardData[] {
    try {
      // 尝试提取JSON数组
      let jsonStr = content.trim()

      // 移除可能的markdown代码块
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }

      const parsed = JSON.parse(jsonStr)

      if (!Array.isArray(parsed)) {
        return []
      }

      return parsed.flatMap(item => {
        const card = parseCardData(item)
        return card ? [card] : []
      })
    } catch {
      return []
    }
  }
}
