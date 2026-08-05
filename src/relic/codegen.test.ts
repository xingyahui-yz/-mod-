/**
 * Relic 代码生成器测试 - 节点编辑器 v0.4
 * v0.5.2：从 src/node-editor/codegen.test.ts 移至 src/relic/codegen.test.ts
 * 覆盖：trigger 派发 + effect 派发 + 模板渲染 + BFS 遍历
 */
import { describe, it, expect } from 'vitest'
import {
  createEmptyGraph, appendNode, connect
} from '../node-editor/graph'
import { generateRelicCode, SUPPORTED_TRIGGERS, SUPPORTED_EFFECTS } from './codegen'
import { RelicData } from './RelicData'

function buildRelic(overrides: Partial<RelicData> = {}): RelicData {
  return {
    id: 'burning_blood',
    name: 'Burning Blood',
    description: '战斗结束时回复 6 点生命',
    tier: 'Common',
    rarity: 'Starter',
    ...overrides
  }
}

function buildRelicGraph() {
  let g = createEmptyGraph('burning_blood', 'relic')
  const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
  g = g1
  const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'gainBuff', buffType: 'Strength', amount: 2 })
  g = g2
  const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
  if (!c.ok) throw new Error('connect failed')
  return c.graph
}

describe('SUPPORTED_TRIGGERS / SUPPORTED_EFFECTS', () => {
  it('至少 3 个 trigger 事件', () => {
    expect(SUPPORTED_TRIGGERS.length).toBeGreaterThanOrEqual(3)
    expect(SUPPORTED_TRIGGERS).toContain('onCombatStart')
  })

  it('至少 4 个 effect 类型', () => {
    expect(SUPPORTED_EFFECTS.length).toBeGreaterThanOrEqual(4)
    expect(SUPPORTED_EFFECTS).toContain('gainBuff')
  })
})

describe('generateRelicCode - 基本渲染', () => {
  it('包含 namespace 和 class 名', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic({ id: 'burning_blood' }))
    expect(code).toContain('namespace MyMod.Relics')
    expect(code).toContain('public class BurningBlood : RelicComponent')
  })

  it('SetDefaults 包含 name/description/tier/rarity/id', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic({
      name: 'Burning Blood',
      description: '回复 HP',
      tier: 'Common',
      rarity: 'Starter',
      id: 'burning_blood'
    }))
    expect(code).toContain('Name = "Burning Blood"')
    expect(code).toContain('Description = "回复 HP"')
    expect(code).toContain('Tier = RelicTier.Common')
    expect(code).toContain('Rarity = RelicRarity.Starter')
    expect(code).toContain('ID = "burning_blood"')
  })

  it('class 名转 PascalCase + 特殊字符清理', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic({ id: 'ancient-tee-ts!!' }))
    // 末尾的 ! 因为后面没字符，toPascalCase 不会切掉，但 codegen 会再清一遍
    expect(code).toContain('public class AncientTeeTs : RelicComponent')
  })

  it('空 id 走 fallback 到 name', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic({ id: '', name: 'iron clad' }))
    expect(code).toContain('public class IronClad : RelicComponent')
  })
})

describe('generateRelicCode - trigger 派发', () => {
  it('onCombatStart 生成 OnCombatStart 方法', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic())
    expect(code).toContain('public override void OnCombatStart()')
  })

  it('onTurnStart 生成 OnTurnStart 方法', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1 } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onTurnStart' })
    g = g1
    const code = generateRelicCode(g, buildRelic())
    expect(code).toContain('public override void OnTurnStart()')
  })

  it('未知 trigger 事件被跳过', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1 } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onUnknownEvent' })
    g = g1
    const code = generateRelicCode(g, buildRelic())
    expect(code).not.toContain('OnUnknownEvent')
  })
})

describe('generateRelicCode - effect 派发', () => {
  it('gainBuff 生成 ApplyBuff 语句', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic())
    expect(code).toMatch(/ApplyBuff\("Strength", 2\);/)
  })

  it('loseHp 生成 Owner.LoseHp 语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onTurnStart' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'loseHp', amount: 5 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    const code = generateRelicCode(c.graph, buildRelic())
    expect(code).toMatch(/Owner\.LoseHp\(5\);/)
  })

  it('gainGold 生成 Owner.GainGold 语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'gainGold', amount: 50 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    const code = generateRelicCode(c.graph, buildRelic())
    expect(code).toMatch(/Owner\.GainGold\(50\);/)
  })

  it('drawCards 生成 Owner.DrawCards 语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onTurnStart' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'drawCards', amount: 2 })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    const code = generateRelicCode(c.graph, buildRelic())
    expect(code).toMatch(/Owner\.DrawCards\(2\);/)
  })

  it('未知 effect kind 不生成语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    g = g1
    const { graph: g2, node: e } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'unknownEffect' })
    g = g2
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    const code = generateRelicCode(c.graph, buildRelic())
    expect(code).toContain('public override void OnCombatStart()')
    // 方法体只有空行，无异常语句
    expect(code).not.toContain('unknownEffect')
  })
})

describe('generateRelicCode - 图遍历', () => {
  it('trigger → effect 链正确生成单条语句', () => {
    const graph = buildRelicGraph()
    const code = generateRelicCode(graph, buildRelic())
    // OnCombatStart() 方法体应包含 ApplyBuff
    const match = code.match(/public override void OnCombatStart\(\)\s*\{([^}]*)\}/)
    expect(match).toBeTruthy()
    expect(match![1]).toContain('ApplyBuff("Strength", 2);')
  })

  it('trigger → 多个 effect 收集所有语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    g = g1
    const { graph: g2, node: e1 } = appendNode(g, 'effect', { x: 100, y: -30 }, { kind: 'gainGold', amount: 50 })
    g = g2
    const { graph: g3, node: e2 } = appendNode(g, 'effect', { x: 100, y: 30 }, { kind: 'drawCards', amount: 2 })
    g = g3
    const c1 = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e1.id, port: 'in' })
    if (!c1.ok) throw new Error('c1 failed')
    const c2 = connect(c1.graph, { nodeId: t.id, port: 'out' }, { nodeId: e2.id, port: 'in' })
    if (!c2.ok) throw new Error('c2 failed')

    const code = generateRelicCode(c2.graph, buildRelic())
    expect(code).toContain('Owner.GainGold(50);')
    expect(code).toContain('Owner.DrawCards(2);')
  })

  it('trigger → effect → effect 链也收集所有语句', () => {
    let g = createEmptyGraph('r', 'relic')
    const { graph: g1, node: t } = appendNode(g, 'trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    g = g1
    const { graph: g2, node: e1 } = appendNode(g, 'effect', { x: 100, y: 0 }, { kind: 'gainGold', amount: 50 })
    g = g2
    const { graph: g3, node: e2 } = appendNode(g, 'effect', { x: 200, y: 0 }, { kind: 'drawCards', amount: 3 })
    g = g3
    const c1 = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e1.id, port: 'in' })
    if (!c1.ok) throw new Error('c1 failed')
    const c2 = connect(c1.graph, { nodeId: e1.id, port: 'out' }, { nodeId: e2.id, port: 'in' })
    if (!c2.ok) throw new Error('c2 failed')

    const code = generateRelicCode(c2.graph, buildRelic())
    expect(code).toContain('Owner.GainGold(50);')
    expect(code).toContain('Owner.DrawCards(3);')
  })

  it('空图只渲染类骨架，不生成方法', () => {
    const graph = createEmptyGraph('r', 'relic')
    const code = generateRelicCode(graph, buildRelic())
    expect(code).toContain('public class BurningBlood : RelicComponent')
    expect(code).not.toContain('OnCombatStart')
    expect(code).not.toContain('OnTurnStart')
  })
})