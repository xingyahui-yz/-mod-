/**
 * 跨实体节点种类注册表（v0.9 — ADR-0006 v1.3）
 *
 * 把所有实体的 trigger / effect kind 定义归一到此：
 *  - 之前 src/relic/kinds.ts 的 TRIGGER_KINDS / EFFECT_KINDS（Relic 私有）
 *  - 未来 Card / Potion / Enemy / Event 等实体各自延展
 *
 * 设计原则：
 *  - trigger 是实体绑定的：每条 trigger 定义带 `entity: 'card' | 'relic' | ...` 字段
 *    UI 层按 entity 过滤 palette（CardEditor 看不到 Relic trigger）
 *    validateGraph 校验 trigger.entity === graph.entityType（跨实体 trigger 拒绝）
 *  - effect 大部分通用：通用副作用（dealDamage / healHp / gainBlock / applyBuff /
 *    applyDebuff / drawCards / gainEnergy）所有实体共享一条；实体绑定 effect 各占
 *    一条（命名带 Self / Card / ToEventTarget 后缀），见 ADR-0006 §决策 §6
 *  - 一处定义，多处消费：codegen 读 emitStatement / methodName 派发；编辑器读
 *    defaultData 作为新节点默认填充；validateGraph 读 entity 字段校验
 *
 * v0.9 当前范围：
 *  - 实体类型：relic, card (其余 character/potion/event/enemy/buff/ui 延后)
 *  - Relic trigger 3 (现有 onCombatStart / onTurnStart / onCardPlayed) — 其余 4 个
 *    (onCombatEnd / onTurnEnd / onAnyCardExhausted / onAnyCardDiscarded) 等 v0.9 Step 7
 *  - Card trigger 4 (onPlay / onSelfDraw / onSelfExhaust / onSelfDiscard) — 等 v0.9 Step 4
 *    (CardEditor) 接入
 *  - Relic effect 4 (现有 gainBuff / loseHp / gainGold / drawCards) — 等 v0.9 Step 7
 *    增加 3 个形态 2 effect
 *  - Card effect 4 (exhaustSelf / discardSelf / addCardToHand / addCardToDeck) 等 Step 4
 *  - 通用 effect 7 (dealDamage / healHp / gainBlock / applyBuff / applyDebuff / drawCards /
 *    gainEnergy) 等 Step 7 整合 (drawCards 复用现有 Relic 版)
 */

import { EntityType } from '../node-editor/types'

/** trigger 节点种类（生命周期事件） */
export interface TriggerKind {
  /** kind id：与节点 data.event 字段一致 */
  kind: string
  /** 实体绑定：UI palette 按此过滤 + validateGraph 跨实体校验 */
  entity: EntityType
  /** UI 显示名 */
  label: string
  /** 派发到的 C# 方法名 */
  methodName: string
  /** 添加 trigger 节点时的默认 data */
  defaultData: Record<string, unknown>
  /** 形态 2 标识：触发器订阅外部事件，effect 节点可访问 event target。
   *  仅 Relic 的 onAny* 系列为 true。Card 的 onSelf* 是形态 1（卡自触发），不走 event target。 */
  isAnyTrigger?: boolean
}

/** effect 节点种类（实际效果） */
export interface EffectKind {
  /** kind id：与节点 data.kind 字段一致 */
  kind: string
  /** UI 显示名 */
  label: string
  /** 派发函数：data → C# 语句（返回 null 表示该 kind 已知但不可生成代码） */
  emitStatement: (data: Record<string, unknown>) => string | null
  /** 添加 effect 节点时的默认 data */
  defaultData: Record<string, unknown>
  /** 实体绑定（可选）：仅实体专属 effect 标记（如 exhaustSelf / exhaustCard） */
  entity?: EntityType
  /** 形态 2 标识：effect 操作 event target（仅 Relic 形态 2 effect 为 true） */
  isEventTargetEffect?: boolean
}

/** 触发器注册表 — v0.9 Step 1 起步：3 个 Relic trigger (现有)
 *  - Card 4 个 trigger 在 Step 4 (CardEditor) 时加入
 *  - Relic 其余 4 个 trigger (onCombatEnd / onTurnEnd / onAnyCardExhausted / onAnyCardDiscarded) 在 Step 7 加入 */
export const TRIGGER_KINDS: Record<string, TriggerKind> = {
  onCombatStart: {
    kind: 'onCombatStart',
    entity: 'relic',
    label: '战斗开始',
    methodName: 'OnCombatStart',
    defaultData: { event: 'onCombatStart' },
  },
  onTurnStart: {
    kind: 'onTurnStart',
    entity: 'relic',
    label: '回合开始',
    methodName: 'OnTurnStart',
    defaultData: { event: 'onTurnStart' },
  },
  onCardPlayed: {
    kind: 'onCardPlayed',
    entity: 'relic',
    label: '卡牌打出',
    methodName: 'OnCardPlayed',
    defaultData: { event: 'onCardPlayed' },
  },
}

/** 效果注册表 — v0.9 Step 1 起步：4 个 Relic effect (现有)
 *  - Card 专属 4 个 effect (exhaustSelf / discardSelf / addCardToHand / addCardToDeck) 在 Step 4 加入
 *  - Relic 形态 2 3 个 effect (exhaustCard / applyBuffToEventTarget / applyDebuffToEventTarget) 在 Step 7 加入
 *  - 通用 effect 7 个 (dealDamage / healHp / gainBlock / applyBuff / applyDebuff / gainEnergy) 在 Step 7 整合 */
export const EFFECT_KINDS: Record<string, EffectKind> = {
  gainBuff: {
    kind: 'gainBuff',
    label: '获得 Buff',
    emitStatement: (d) => {
      const buff = String(d.buffType ?? 'Strength')
      const amount = Number(d.amount ?? 1)
      return `ApplyBuff("${buff}", ${amount});`
    },
    defaultData: { kind: 'gainBuff', buffType: 'Strength', amount: 1 },
  },
  loseHp: {
    kind: 'loseHp',
    label: '失去生命',
    emitStatement: (d) => {
      const amount = Number(d.amount ?? 1)
      return `Owner.LoseHp(${amount});`
    },
    defaultData: { kind: 'loseHp', amount: 1 },
  },
  gainGold: {
    kind: 'gainGold',
    label: '获得金币',
    emitStatement: (d) => {
      const amount = Number(d.amount ?? 1)
      return `Owner.GainGold(${amount});`
    },
    defaultData: { kind: 'gainGold', amount: 50 },
  },
  drawCards: {
    kind: 'drawCards',
    label: '抽牌',
    emitStatement: (d) => {
      const amount = Number(d.amount ?? 1)
      return `Owner.DrawCards(${amount});`
    },
    defaultData: { kind: 'drawCards', amount: 2 },
  },
}

/** UI dropdown / 按钮遍历用的 trigger 列表（向后兼容：RelicEditor 用） */
export const SUPPORTED_TRIGGERS = Object.keys(TRIGGER_KINDS)

/** UI dropdown / 按钮遍历用的 effect 列表（向后兼容：RelicEditor 用） */
export const SUPPORTED_EFFECTS = Object.keys(EFFECT_KINDS)

/**
 * 按 entityType 过滤 trigger 列表（Card / Relic editor palette 用）— v0.9 Step 2 实现
 * - Card editor: 只看到 entity === 'card' 的 trigger
 * - Relic editor: 只看到 entity === 'relic' 的 trigger
 * - 未来 Enemy/Event editor: 同理
 */
export function triggersForEntity(entityType: EntityType): string[] {
  return Object.keys(TRIGGER_KINDS).filter(k => TRIGGER_KINDS[k].entity === entityType)
}

/**
 * 按 entityType 过滤 effect 列表（Card / Relic editor palette 用）
 * - 通用 effect (entity 未设置) 所有实体可见
 * - 实体绑定 effect 只对对应实体可见
 */
export function effectsForEntity(entityType: EntityType): string[] {
  return Object.keys(EFFECT_KINDS).filter(k => {
    const ek = EFFECT_KINDS[k]
    return !ek.entity || ek.entity === entityType
  })
}