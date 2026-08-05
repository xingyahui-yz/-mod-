/**
 * Relic kinds registry 测试（v0.5.2 part 2）
 *
 * 覆盖：
 *  - TRIGGER_KINDS / EFFECT_KINDS 完整性
 *  - defaultData 与 v0.5.1 RelicEditor defaults 表一致（防止 kinds 改默认值导致 UI 默认节点变化）
 *  - emitStatement 输出符合 codegen.test.ts 中对 generateRelicCode 的断言
 *  - SUPPORTED_TRIGGERS / SUPPORTED_EFFECTS 派生正确
 */
import { describe, it, expect } from 'vitest'
import {
  TRIGGER_KINDS,
  EFFECT_KINDS,
  SUPPORTED_TRIGGERS,
  SUPPORTED_EFFECTS,
  type RelicTriggerKind,
  type RelicEffectKind,
} from './kinds'

describe('TRIGGER_KINDS', () => {
  it('至少 3 个 trigger 事件', () => {
    expect(Object.keys(TRIGGER_KINDS).length).toBeGreaterThanOrEqual(3)
  })

  it('含 onCombatStart / onTurnStart / onCardPlayed', () => {
    expect(SUPPORTED_TRIGGERS).toEqual(
      expect.arrayContaining(['onCombatStart', 'onTurnStart', 'onCardPlayed'])
    )
  })

  it('每个 trigger kind 字段完整', () => {
    for (const [kind, t] of Object.entries(TRIGGER_KINDS)) {
      expect(t.kind, `${kind}.kind`).toBe(kind)  // key 与 kind 字段一致
      expect(t.label, `${kind}.label`).toBeTruthy()
      expect(t.methodName, `${kind}.methodName`).toBeTruthy()
      expect(t.defaultData, `${kind}.defaultData`).toBeTypeOf('object')
      expect(t.defaultData.event, `${kind}.defaultData.event`).toBe(kind)
    }
  })

  it('onCombatStart → OnCombatStart', () => {
    const t: RelicTriggerKind = TRIGGER_KINDS.onCombatStart
    expect(t.methodName).toBe('OnCombatStart')
  })

  it('onTurnStart → OnTurnStart', () => {
    expect(TRIGGER_KINDS.onTurnStart.methodName).toBe('OnTurnStart')
  })

  it('onCardPlayed → OnCardPlayed', () => {
    expect(TRIGGER_KINDS.onCardPlayed.methodName).toBe('OnCardPlayed')
  })
})

describe('EFFECT_KINDS', () => {
  it('至少 4 个 effect 类型', () => {
    expect(Object.keys(EFFECT_KINDS).length).toBeGreaterThanOrEqual(4)
  })

  it('含 gainBuff / loseHp / gainGold / drawCards', () => {
    expect(SUPPORTED_EFFECTS).toEqual(
      expect.arrayContaining(['gainBuff', 'loseHp', 'gainGold', 'drawCards'])
    )
  })

  it('每个 effect kind 字段完整', () => {
    for (const [kind, e] of Object.entries(EFFECT_KINDS)) {
      expect(e.kind, `${kind}.kind`).toBe(kind)
      expect(e.label, `${kind}.label`).toBeTruthy()
      expect(e.emitStatement, `${kind}.emitStatement`).toBeTypeOf('function')
      expect(e.defaultData, `${kind}.defaultData`).toBeTypeOf('object')
      expect(e.defaultData.kind, `${kind}.defaultData.kind`).toBe(kind)
    }
  })

  it('gainBuff 默认值（v0.5.1 RelicEditor defaults 表保持一致）', () => {
    expect(EFFECT_KINDS.gainBuff.defaultData).toEqual({
      kind: 'gainBuff',
      buffType: 'Strength',
      amount: 1,
    })
  })

  it('loseHp 默认值', () => {
    expect(EFFECT_KINDS.loseHp.defaultData).toEqual({ kind: 'loseHp', amount: 1 })
  })

  it('gainGold 默认值', () => {
    expect(EFFECT_KINDS.gainGold.defaultData).toEqual({ kind: 'gainGold', amount: 50 })
  })

  it('drawCards 默认值', () => {
    expect(EFFECT_KINDS.drawCards.defaultData).toEqual({ kind: 'drawCards', amount: 2 })
  })

  it('gainBuff emitStatement 接受 buffType/amount', () => {
    expect(EFFECT_KINDS.gainBuff.emitStatement({ kind: 'gainBuff', buffType: 'Dexterity', amount: 3 }))
      .toBe('ApplyBuff("Dexterity", 3);')
  })

  it('gainBuff emitStatement 缺字段有 fallback', () => {
    expect(EFFECT_KINDS.gainBuff.emitStatement({})).toBe('ApplyBuff("Strength", 1);')
  })

  it('loseHp emitStatement', () => {
    expect(EFFECT_KINDS.loseHp.emitStatement({ kind: 'loseHp', amount: 5 }))
      .toBe('Owner.LoseHp(5);')
  })

  it('gainGold emitStatement', () => {
    expect(EFFECT_KINDS.gainGold.emitStatement({ kind: 'gainGold', amount: 100 }))
      .toBe('Owner.GainGold(100);')
  })

  it('drawCards emitStatement', () => {
    expect(EFFECT_KINDS.drawCards.emitStatement({ kind: 'drawCards', amount: 3 }))
      .toBe('Owner.DrawCards(3);')
  })
})

describe('SUPPORTED_* 派生', () => {
  it('SUPPORTED_TRIGGERS === Object.keys(TRIGGER_KINDS)', () => {
    expect(SUPPORTED_TRIGGERS).toEqual(Object.keys(TRIGGER_KINDS))
  })

  it('SUPPORTED_EFFECTS === Object.keys(EFFECT_KINDS)', () => {
    expect(SUPPORTED_EFFECTS).toEqual(Object.keys(EFFECT_KINDS))
  })
})

describe('类型导出', () => {
  it('RelicTriggerKind 类型可被消费（编译期检查）', () => {
    // 仅用于触发 TypeScript 类型检查
    const t: RelicTriggerKind = TRIGGER_KINDS.onCombatStart
    expect(t.kind).toBe('onCombatStart')
  })

  it('RelicEffectKind 类型可被消费（编译期检查）', () => {
    const e: RelicEffectKind = EFFECT_KINDS.gainBuff
    expect(e.emitStatement({})).toBe('ApplyBuff("Strength", 1);')
  })
})
