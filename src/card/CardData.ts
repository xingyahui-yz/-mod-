/**
 * Card data model - 节点编辑器 Card 实体 (v0.9)
 *
 * v0.9 Step 4 (ADR-0006 §决策 §5): CardData 增加 `target` 字段
 *   - target = 'self' (默认) — effect 操作自己 (形态 1: 卡自触发, onSelf*)
 *   - target = 'eventTarget' — effect 操作事件目标 (形态 2: Any trigger 后, onAny*)
 *
 * 形态 2 路径要走通需要 v0.9 Step 7 把形态 2 trigger (onAnyCardExhausted 等) 和
 * 形态 2 effect (exhaustCard / applyBuffToEventTarget 等) 加进 shared/kinds.ts。
 * 当前 Step 4 只走形态 1 (target='self')；target 字段先建好, codegen 暂不消费
 * (Step 6 接入)。
 *
 * v0.9 节点版 CardData 与 types/index.ts 里 form-based 的 CardData 是两套：
 *   - types/index.ts: name/cost/type/rarity/description/keywords/imagePath (form 用)
 *   - card/CardData.ts: 上面所有 + target (节点编辑器用)
 *   共享字段两边都用相同的 name/cost/type/rarity/description，target 是节点版独有。
 */

export type CardTarget = 'self' | 'eventTarget'

export interface CardData {
  /** C# class 名 (PascalCase) */
  id: string
  /** 显示名 */
  name: string
  /** 费用 */
  cost: number
  /** 类型 */
  type: 'Attack' | 'Skill' | 'Power'
  /** 稀有度 */
  rarity: 'Common' | 'Uncommon' | 'Rare'
  /** 描述 */
  description: string
  /** 关键词列表 (comma-separated 字符串拆分) */
  keywords: string[]
  /** v0.9 Step 4 (ADR-0006 §决策 §5): effect 操作的 target
   *  - 'self' (默认) — 形态 1
   *  - 'eventTarget' — 形态 2 (Any trigger 后, v0.9 Step 7 接入)
   *  Step 6 codegen 读这个字段生成不同语句; Step 4 UI 只暴露控件 */
  target: CardTarget
  /** 可选：图片路径 */
  imagePath?: string
}

/** 默认初始 Card */
export function createDefaultCard(): CardData {
  return {
    id: 'my_card',
    name: 'My Card',
    cost: 1,
    type: 'Attack',
    rarity: 'Common',
    description: '',
    keywords: [],
    target: 'self',
  }
}
