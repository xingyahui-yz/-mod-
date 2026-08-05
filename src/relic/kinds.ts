/**
 * Relic 节点种类注册表（v0.5.2）
 *
 * 把原本散在两处的 Relic kind 定义归一到此：
 *  - 之前 codegen.ts 的 TRIGGER_DISPATCH / EFFECT_DISPATCH（codegen 用）
 *  - 之前 RelicEditor.tsx addEffect 的 defaults 表（UI 加节点默认 data）
 *
 * 一处定义，两处消费：codegen 读 emitStatement/methodName 派发，RelicEditor
 * 读 defaultData 作为新节点的默认填充。SUPPORTED_TRIGGERS / SUPPORTED_EFFECTS
 * 从此派生，是数据的所有投影。
 *
 * 未来 v0.9 多实体时，其他实体（Card/Buff 等）应建立自己的 kinds.ts，
 * 同样的"trigger/effect/condition/branch"概念，但具体 kind 不同。
 */

/** trigger 节点种类（生命周期事件） */
export interface RelicTriggerKind {
  /** kind id：与节点 data.event 字段一致 */
  kind: string
  /** UI 显示名 */
  label: string
  /** 派发到的 C# 方法名 */
  methodName: string
  /** 添加 trigger 节点时的默认 data */
  defaultData: Record<string, unknown>
}

/** effect 节点种类（实际效果） */
export interface RelicEffectKind {
  /** kind id：与节点 data.kind 字段一致 */
  kind: string
  /** UI 显示名 */
  label: string
  /** 派发函数：data → C# 语句（返回 null 表示该 kind 已知但不可生成代码） */
  emitStatement: (data: Record<string, unknown>) => string | null
  /** 添加 effect 节点时的默认 data */
  defaultData: Record<string, unknown>
}

/** 触发器注册表：3 个事件 */
export const TRIGGER_KINDS: Record<string, RelicTriggerKind> = {
  onCombatStart: {
    kind: 'onCombatStart',
    label: '战斗开始',
    methodName: 'OnCombatStart',
    defaultData: { event: 'onCombatStart' },
  },
  onTurnStart: {
    kind: 'onTurnStart',
    label: '回合开始',
    methodName: 'OnTurnStart',
    defaultData: { event: 'onTurnStart' },
  },
  onCardPlayed: {
    kind: 'onCardPlayed',
    label: '卡牌打出',
    methodName: 'OnCardPlayed',
    defaultData: { event: 'onCardPlayed' },
  },
}

/** 效果注册表：4 个 effect */
export const EFFECT_KINDS: Record<string, RelicEffectKind> = {
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

/** UI dropdown / 按钮遍历用的 trigger 列表 */
export const SUPPORTED_TRIGGERS = Object.keys(TRIGGER_KINDS)

/** UI dropdown / 按钮遍历用的 effect 列表 */
export const SUPPORTED_EFFECTS = Object.keys(EFFECT_KINDS)
