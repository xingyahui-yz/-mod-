/**
 * 节点编辑器组件测试 - v0.3
 * 覆盖：useNodeGraph hook + NodeGraphCanvas 渲染/拖动/删除 + 边渲染 + 点击删除边 + 序列化往返
 */
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useNodeGraph } from './useNodeGraph'
import { NodeGraphCanvas } from './NodeGraphCanvas'
import { createEmptyGraph, connect, getPortXY, NODE_WIDTH } from './graph'
import { NodeGraph, EntityType } from './types'

describe('useNodeGraph hook', () => {
  it('默认创建空图', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.graph.entityId).toBe('r-1')
    expect(result.current.graph.entityType).toBe('relic')
  })

  it('entityId 变化时重建图，避免编辑器沿用旧实体图', () => {
    const { result, rerender } = renderHook(
      ({ entityId }) => useNodeGraph(entityId, 'relic'),
      { initialProps: { entityId: 'r-1' } }
    )
    act(() => {
      result.current.addNode('effect', { x: 10, y: 20 }, { kind: 'gainBuff' })
    })
    expect(result.current.graph.entityId).toBe('r-1')
    expect(result.current.graph.nodes).toHaveLength(1)

    act(() => {
      rerender({ entityId: 'r-2' })
    })
    expect(result.current.graph.entityId).toBe('r-2')
    expect(result.current.graph.nodes).toHaveLength(0)
  })

  it('addNode 增加节点', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('trigger', { x: 10, y: 20 }, { event: 'onCombatStart' })
    })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].type).toBe('trigger')
  })

  it('moveNode 更新位置', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 0, y: 0 }).id
    })
    act(() => {
      result.current.moveNode(nodeId!, { x: 50, y: 50 })
    })
    expect(result.current.graph.nodes[0].position).toEqual({ x: 50, y: 50 })
  })

  it('removeNode 删除节点', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 0, y: 0 }).id
    })
    act(() => {
      result.current.removeNode(nodeId!)
    })
    expect(result.current.graph.nodes).toHaveLength(0)
  })

  it('exportJson / importJson 往返', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('trigger', { x: 10, y: 20 }, { event: 'onCombatStart' })
      // v0.6: effect.data.kind 现在必填（per-kind data 校验）
      result.current.addNode('effect', { x: 100, y: 20 }, { kind: 'gainBuff' })
    })
    const json = result.current.exportJson()
    expect(json).toContain('trigger')

    // 新 hook 实例 + 导入
    const { result: r2 } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      const r = r2.current.importJson(json)
      expect(r.ok).toBe(true)
    })
    expect(r2.current.graph.nodes).toHaveLength(2)
  })

  it('importJson 拒绝无效 JSON', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    const r = result.current.importJson('not json')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  // v0.6: connect 改纯 updater —— 同一 tick 连 2 次后者不丢前者
  it('connect 同一 tick 连 2 次后者不丢前者（updater 修复闭包旧状态）', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let trigger: ReturnType<typeof result.current.addNode>
    let effectA: ReturnType<typeof result.current.addNode>
    let effectB: ReturnType<typeof result.current.addNode>
    act(() => {
      trigger = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
      effectA = result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'gainBuff' })
      effectB = result.current.addNode('effect', { x: 200, y: 0 }, { kind: 'loseHp' })
    })
    // 同一 tick 连 2 次（trigger.out → effectA.in, trigger.out → effectB.in）
    act(() => {
      const r1 = result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: effectA!.id, port: 'in' }
      )
      const r2 = result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: effectB!.id, port: 'in' }
      )
      expect(r1.ok).toBe(true)
      expect(r2.ok).toBe(true)
    })
    // 两条边都应保留（不是后者覆盖前者）
    expect(result.current.graph.edges).toHaveLength(2)
    expect(result.current.graph.edges.map(e => e.to.nodeId).sort()).toEqual(
      [effectA!.id, effectB!.id].sort()
    )
  })
})

describe('NodeGraphCanvas 渲染', () => {
  it('空图渲染画布但无节点', () => {
    const graph = createEmptyGraph('r-1', 'relic')
    const { container } = render(
      <NodeGraphCanvas
        graph={graph}
        onMoveNode={() => {}}
        onRemoveNode={() => {}}
      />
    )
    const svg = screen.getByTestId('node-graph-canvas')
    expect(svg).toBeTruthy()
    // 节点数量 = 0
    expect(container.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(0)
  })

  it('节点正确渲染（带类型文字）', () => {
    const graph = createEmptyGraph('r-1', 'relic')
    graph.nodes.push({
      id: 'n1',
      type: 'trigger',
      position: { x: 50, y: 50 },
      data: { event: 'onCombatStart' }
    })
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    expect(container.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(1)
    expect(container.textContent).toContain('trigger')
    expect(container.textContent).toContain('event')
  })
})

describe('NodeGraphCanvas 删除', () => {
  it('点击 × 触发 onRemoveNode', () => {
    const graph = createEmptyGraph('r-1', 'relic')
    graph.nodes.push({
      id: 'n1', type: 'effect', position: { x: 0, y: 0 }, data: {}
    })
    const onRemoveNode = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={onRemoveNode} />
    )
    const removeBtn = container.querySelector('[data-testid^="remove-"]') as Element
    expect(removeBtn).toBeTruthy()
    fireEvent.click(removeBtn)
    expect(onRemoveNode).toHaveBeenCalledWith('n1')
  })
})

describe('端到端：创建 → 拖动 → 序列化 → 重载', () => {
  it('节点位置在序列化往返后保留', () => {
    // 步骤 1：创建图
    let g: NodeGraph = createEmptyGraph('r-end-to-end', 'relic')

    // 步骤 2：添加节点
    let n = g
    const r1 = (() => {
      // 模拟 useNodeGraph 的 addNode 行为
      return {
        graph: {
          ...n,
          nodes: [...n.nodes, { id: 'a', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }],
          metadata: { ...n.metadata, updatedAt: new Date().toISOString() }
        },
        node: { id: 'a', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
      }
    })()
    g = r1.graph as NodeGraph

    // 步骤 3：移动到 (100, 50)
    g = {
      ...g,
      nodes: g.nodes.map(node =>
        node.id === 'a' ? { ...node, position: { x: 100, y: 50 } } : node
      )
    }

    // 步骤 4：序列化
    const json = JSON.stringify(g)

    // 步骤 5：反序列化
    const restored = JSON.parse(json) as NodeGraph
    expect(restored.nodes[0].position).toEqual({ x: 100, y: 50 })

    // 步骤 6：渲染还原后的图
    const { container } = render(
      <NodeGraphCanvas graph={restored} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    const nodeGroup = container.querySelector('[data-testid="node-box-a"]') as Element
    expect(nodeGroup).toBeTruthy()
    expect(nodeGroup.getAttribute('transform')).toBe('translate(100, 50)')
  })
})

// ============================================================================
// v0.3: 边渲染 + 点击删除边
// ============================================================================

describe('NodeGraphCanvas 边渲染 (v0.3)', () => {
  it('无节点时不渲染 <path>', () => {
    const graph = createEmptyGraph('r-1', 'relic')
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    expect(container.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(0)
  })

  it('一条边渲染一个 <path>，带 data-testid', () => {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    const t = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
    const e = { id: 'e', type: 'effect' as const, position: { x: 100, y: 0 }, data: {} }
    g = { ...g, nodes: [t, e] }
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')
    const { container } = render(
      <NodeGraphCanvas graph={c.graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    const paths = container.querySelectorAll('[data-testid^="edge-"]')
    expect(paths).toHaveLength(1)
    const path = paths[0] as Element
    expect(path.getAttribute('d')).toMatch(/^M 120 15 C /)
  })

  it('两条边渲染两个 <path>', () => {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    const t = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
    const cnd = { id: 'c', type: 'condition' as const, position: { x: 100, y: 0 }, data: {} }
    const e = { id: 'e', type: 'effect' as const, position: { x: 200, y: 0 }, data: {} }
    g = { ...g, nodes: [t, cnd, e] }
    const r1 = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: cnd.id, port: 'in' })
    if (!r1.ok) throw new Error('r1 failed')
    const r2 = connect(r1.graph, { nodeId: cnd.id, port: 'true' }, { nodeId: e.id, port: 'in' })
    if (!r2.ok) throw new Error('r2 failed')
    const { container } = render(
      <NodeGraphCanvas graph={r2.graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    expect(container.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(2)
  })
})

describe('NodeGraphCanvas 点击边删除 (v0.3)', () => {
  it('点击 path 触发 onDisconnect(edgeId)', () => {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    const t = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
    const e = { id: 'e', type: 'effect' as const, position: { x: 100, y: 0 }, data: {} }
    g = { ...g, nodes: [t, e] }
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')

    const onDisconnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas
        graph={c.graph}
        onMoveNode={() => {}}
        onRemoveNode={() => {}}
        onDisconnect={onDisconnect}
      />
    )
    const edgePath = container.querySelector('[data-testid^="edge-"]') as Element
    expect(edgePath).toBeTruthy()
    fireEvent.click(edgePath)
    expect(onDisconnect).toHaveBeenCalledTimes(1)
    expect(onDisconnect).toHaveBeenCalledWith(c.graph.edges[0].id)
  })

  it('没传 onDisconnect 时点击不会崩溃', () => {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    const t = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
    const e = { id: 'e', type: 'effect' as const, position: { x: 100, y: 0 }, data: {} }
    g = { ...g, nodes: [t, e] }
    const c = connect(g, { nodeId: t.id, port: 'out' }, { nodeId: e.id, port: 'in' })
    if (!c.ok) throw new Error('connect failed')

    const { container } = render(
      <NodeGraphCanvas graph={c.graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    const edgePath = container.querySelector('[data-testid^="edge-"]') as Element
    expect(() => fireEvent.click(edgePath)).not.toThrow()
  })
})

describe('端到端 (v0.3): useNodeGraph → canvas → 三节点两连线', () => {
  it('trigger → condition → effect 完整路径', () => {
    const { result } = renderHook(() => useNodeGraph('r-e2e-v03', 'relic'))

    let tId: string, cId: string, eId: string
    act(() => {
      tId = result.current.addNode('trigger', { x: 0, y: 0 }).id
      cId = result.current.addNode('condition', { x: 100, y: 0 }).id
      eId = result.current.addNode('effect', { x: 200, y: 0 }).id
    })

    // 连线
    let r1: { ok: boolean; reason?: string }
    act(() => { r1 = result.current.connect({ nodeId: tId!, port: 'out' }, { nodeId: cId!, port: 'in' }) })
    expect(r1!.ok).toBe(true)

    let r2: { ok: boolean; reason?: string }
    act(() => { r2 = result.current.connect({ nodeId: cId!, port: 'true' }, { nodeId: eId!, port: 'in' }) })
    expect(r2!.ok).toBe(true)

    // 断言图状态
    expect(result.current.graph.nodes).toHaveLength(3)
    expect(result.current.graph.edges).toHaveLength(2)

    // 渲染画布并断言路径数量
    const { container } = render(
      <NodeGraphCanvas
        graph={result.current.graph}
        onMoveNode={() => {}}
        onRemoveNode={() => {}}
        onDisconnect={(id) => { act(() => { result.current.disconnect(id) }) }}
      />
    )
    expect(container.querySelectorAll('[data-testid^="node-box-"]')).toHaveLength(3)
    expect(container.querySelectorAll('[data-testid^="edge-"]')).toHaveLength(2)

    // 点击第一条边 → 删除
    const edgeIds = Array.from(
      container.querySelectorAll('[data-testid^="edge-"]')
    ).map(el => el.getAttribute('data-testid')!.replace('edge-', ''))
    expect(edgeIds).toHaveLength(2)

    act(() => {
      fireEvent.click(container.querySelector('[data-testid^="edge-"]') as Element)
    })
    expect(result.current.graph.edges).toHaveLength(1)
  })
})

// ============================================================================
// v0.5: 端口 click-to-connect
// ============================================================================

describe('NodeGraphCanvas 端口点击连线 (v0.5)', () => {
  function setupTwoNodes() {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    const t = { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} }
    const e = { id: 'e', type: 'effect' as const, position: { x: 100, y: 0 }, data: {} }
    g = { ...g, nodes: [t, e] }
    return g
  }

  it('点 output 端口 → 端口变成 pending（白色 + 放大）', () => {
    const graph = setupTwoNodes()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )
    const outPort = container.querySelector('[data-testid="port-t-out"]') as Element
    expect(outPort).toBeTruthy()
    fireEvent.click(outPort)
    // r=6（放大）+ fill 白色
    expect(outPort.getAttribute('r')).toBe('6')
    expect(outPort.getAttribute('fill')).toBe('#ffffff')
  })

  it('点 input 端口（无 pending）→ 不触发 onConnect', () => {
    const graph = setupTwoNodes()
    const onConnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} onConnect={onConnect} />
    )
    const inPort = container.querySelector('[data-testid="port-e-in"]') as Element
    fireEvent.click(inPort)
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('点 output → 点 input → 触发 onConnect(from, to)', () => {
    const graph = setupTwoNodes()
    const onConnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} onConnect={onConnect} />
    )
    fireEvent.click(container.querySelector('[data-testid="port-t-out"]') as Element)
    fireEvent.click(container.querySelector('[data-testid="port-e-in"]') as Element)
    expect(onConnect).toHaveBeenCalledTimes(1)
    expect(onConnect).toHaveBeenCalledWith(
      { nodeId: 't', port: 'out' },
      { nodeId: 'e', port: 'in' }
    )
  })

  it('onConnect 触发后 pendingFrom 清空（input 端口变回普通色）', () => {
    const graph = setupTwoNodes()
    const onConnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} onConnect={onConnect} />
    )
    fireEvent.click(container.querySelector('[data-testid="port-t-out"]') as Element)
    fireEvent.click(container.querySelector('[data-testid="port-e-in"]') as Element)
    const outPort = container.querySelector('[data-testid="port-t-out"]') as Element
    expect(outPort.getAttribute('fill')).not.toBe('#ffffff')
    expect(outPort.getAttribute('r')).toBe('4')
  })

  it('点空白画布 → 取消 pendingFrom', () => {
    const graph = setupTwoNodes()
    const onConnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} onConnect={onConnect} />
    )
    fireEvent.click(container.querySelector('[data-testid="port-t-out"]') as Element)
    // 验证 pending
    const outPort = container.querySelector('[data-testid="port-t-out"]') as Element
    expect(outPort.getAttribute('fill')).toBe('#ffffff')
    // 点空白
    fireEvent.click(container.querySelector('[data-testid="node-graph-canvas"]') as Element)
    // pending 清空
    expect(outPort.getAttribute('fill')).not.toBe('#ffffff')
  })

  it('点 input 时若有 pending source → 触发 onConnect 后清空；点 input 时无 pending source → no-op', () => {
    const graph = setupTwoNodes()
    const onConnect = vi.fn()
    const { container } = render(
      <NodeGraphCanvas graph={graph} onMoveNode={() => {}} onRemoveNode={() => {}} onConnect={onConnect} />
    )
    // 无 pending → 点 input 不触发
    fireEvent.click(container.querySelector('[data-testid="port-e-in"]') as Element)
    expect(onConnect).toHaveBeenCalledTimes(0)
    // 设 pending → 点 input 触发一次
    fireEvent.click(container.querySelector('[data-testid="port-t-out"]') as Element)
    fireEvent.click(container.querySelector('[data-testid="port-e-in"]') as Element)
    expect(onConnect).toHaveBeenCalledTimes(1)
    // pending 清空后再点 input → 不再触发
    fireEvent.click(container.querySelector('[data-testid="port-e-in"]') as Element)
    expect(onConnect).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// v0.5.1: NodeGraphCanvas 端口坐标 === getPortXY 输出
// 契约：canvas 端口 cx/cy 必须与 graph.ts 的 getPortXY 一致，否则两份几何会发散
// ============================================================================

describe('NodeGraphCanvas 端口坐标 = getPortXY (v0.5.1)', () => {
  it('所有节点类型的端口 cx/cy 与 getPortXY 完全一致', () => {
    // setup: 一图四种节点类型，覆盖单端口 (trigger/branch) + 多端口 (condition: in/true/false)
    // 用 UUID-style nodeId 避免 portId 解析歧义（端口 in/out/true/false 都不含 '-'）
    const nodes = [
      { id: 'nodeT', type: 'trigger',   position: { x: 0,   y: 0 }, data: {} },
      { id: 'nodeC', type: 'condition', position: { x: 200, y: 0 }, data: {} },
      { id: 'nodeE', type: 'effect',    position: { x: 400, y: 0 }, data: {} },
      { id: 'nodeB', type: 'branch',    position: { x: 600, y: 0 }, data: {} },
    ] as const
    let g: NodeGraph = { ...createEmptyGraph('r-geom', 'relic'), nodes: [...nodes] }

    const { container } = render(
      <NodeGraphCanvas graph={g} onMoveNode={() => {}} onRemoveNode={() => {}} />
    )

    // 显式枚举所有节点 + 端口（data-testid 格式: port-{nodeId}-{portId}）
    // portId 都是 in/out/true/false，没有 '-'，所以可以按 'port-{nodeId}-' 前缀 + portId 后缀定位
    const cases: { nodeId: string; portId: string }[] = []
    for (const n of nodes) {
      // 节点的端口声明来自 NODE_PORT_DEFS，但 graph.ts 已导出
      // 这里用 NODE_PORT_DEFS 的简化版：trigger=out, condition=in/true/false, effect=in/out, branch=in/out
      const portMap: Record<string, string[]> = {
        trigger: ['out'],
        condition: ['in', 'true', 'false'],
        effect: ['in', 'out'],
        branch: ['in', 'out'],
      }
      for (const portId of portMap[n.type]) {
        cases.push({ nodeId: n.id, portId })
      }
    }

    expect(cases.length).toBeGreaterThan(0)  // sanity: trigger=1 + cond=3 + effect=2 + branch=2 = 8 ports

    for (const { nodeId, portId } of cases) {
      const el = container.querySelector(`[data-testid="port-${nodeId}-${portId}"]`) as Element
      expect(el, `${nodeId}.${portId} 元素应存在`).toBeTruthy()

      const node = g.nodes.find(n => n.id === nodeId)!
      const { x, y } = getPortXY(node, portId)
      const cx = el.getAttribute('cx')
      const cy = el.getAttribute('cy')

      expect(cx, `${nodeId}.${portId} cx`).toBe(String(x))
      expect(cy, `${nodeId}.${portId} cy`).toBe(String(y))
    }
  })

  it('trigger 端口 cx = NODE_WIDTH（output 在右）', () => {
    // 局部断言：trigger 的唯一端口是 output，在 NODE_WIDTH 处
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    g = { ...g, nodes: [{ id: 't', type: 'trigger', position: { x: 0, y: 0 }, data: {} }] }
    const { container } = render(<NodeGraphCanvas graph={g} onMoveNode={() => {}} onRemoveNode={() => {}} />)
    const port = container.querySelector('[data-testid="port-t-out"]') as Element
    expect(port.getAttribute('cx')).toBe(String(NODE_WIDTH))
  })

  it('effect 的 input 端口 cx = 0（在左）', () => {
    let g: NodeGraph = createEmptyGraph('r-1', 'relic')
    g = { ...g, nodes: [{ id: 'e', type: 'effect', position: { x: 0, y: 0 }, data: {} }] }
    const { container } = render(<NodeGraphCanvas graph={g} onMoveNode={() => {}} onRemoveNode={() => {}} />)
    const port = container.querySelector('[data-testid="port-e-in"]') as Element
    expect(port.getAttribute('cx')).toBe('0')
  })
})

// ============================================================================
// v0.6: pendingFrom 悬挂（stale）派生 effectivePending
// 契约：选 output 后删除该节点，再点 input 不应触发 onConnect（因为 source 已不存在）
// ============================================================================

describe('NodeGraphCanvas pendingFrom 悬挂 (v0.6)', () => {
  it('源节点被删后 pendingFrom 自动失效（点 input 不连线）', () => {
    const onConnect = vi.fn()

    function Harness() {
      const [graph, setGraph] = useState<NodeGraph>(() => {
        let g = createEmptyGraph('r-1', 'relic')
        g = {
          ...g,
          nodes: [
            { id: 't', type: 'trigger' as const, position: { x: 0, y: 0 }, data: {} },
            { id: 'e', type: 'effect' as const, position: { x: 100, y: 0 }, data: {} }
          ]
        }
        return g
      })
      const onRemoveNode = (id: string) => {
        setGraph(prev => ({
          ...prev,
          nodes: prev.nodes.filter(n => n.id !== id)
        }))
      }
      return (
        <NodeGraphCanvas
          graph={graph}
          onMoveNode={() => {}}
          onRemoveNode={onRemoveNode}
          onConnect={onConnect}
        />
      )
    }

    const { container } = render(<Harness />)

    // 1) 点 output 端口 → pendingFrom 被设置，视觉变为 pending（白+放大）
    const outPort = container.querySelector('[data-testid="port-t-out"]') as Element
    expect(outPort).toBeTruthy()
    fireEvent.click(outPort)
    expect(outPort.getAttribute('r')).toBe('6')
    expect(outPort.getAttribute('fill')).toBe('#ffffff')

    // 2) 删除 source 节点（trigger）
    fireEvent.click(container.querySelector('[data-testid="remove-t"]') as Element)
    // 节点 't' 已不在 DOM
    expect(container.querySelector('[data-testid="node-box-t"]')).toBeNull()
    expect(container.querySelector('[data-testid="port-t-out"]')).toBeNull()

    // 3) 点 effect 的 input 端口 — effectivePending 应为 null（t 已删），不应触发 onConnect
    const inPort = container.querySelector('[data-testid="port-e-in"]') as Element
    expect(inPort).toBeTruthy()
    fireEvent.click(inPort)
    expect(onConnect).not.toHaveBeenCalled()

    // 4) input 端口也不应有 target-candidate 高亮（无 pending source）
    expect(inPort.getAttribute('stroke')).toBe('none')
  })
})

// v0.7: undo / redo
// 覆盖设计文档 §测试矩阵 10 项
// ============================================================================

describe('useNodeGraph undo/redo (v0.7)', () => {
  it('1. 初始 canUndo=false / canRedo=false', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('2. add → undo 恢复空图；redo 恢复节点', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 10, y: 20 }, { kind: 'gainBuff' }).id
    })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)

    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    act(() => { result.current.redo() })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].id).toBe(nodeId!)
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('3. move → undo 恢复旧坐标', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' }).id
    })
    act(() => {
      result.current.moveNode(nodeId!, { x: 50, y: 60 })
    })
    expect(result.current.graph.nodes[0].position).toEqual({ x: 50, y: 60 })

    act(() => { result.current.undo() })
    expect(result.current.graph.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('4. connect → undo 删除边；redo 恢复边', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let triggerId: string, effectId: string
    act(() => {
      triggerId = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' }).id
      effectId = result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'gainBuff' }).id
    })
    act(() => {
      const r = result.current.connect(
        { nodeId: triggerId!, port: 'out' },
        { nodeId: effectId!, port: 'in' }
      )
      expect(r.ok).toBe(true)
    })
    expect(result.current.graph.edges).toHaveLength(1)
    const edgeId = result.current.graph.edges[0].id

    act(() => { result.current.undo() })
    expect(result.current.graph.edges).toHaveLength(0)

    act(() => { result.current.redo() })
    expect(result.current.graph.edges).toHaveLength(1)
    expect(result.current.graph.edges[0].id).toBe(edgeId)
  })

  it('5. remove（带边）→ undo 同时恢复节点和边', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let triggerId: string, effectId: string
    act(() => {
      triggerId = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' }).id
      effectId = result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'gainBuff' }).id
    })
    act(() => {
      const r = result.current.connect(
        { nodeId: triggerId!, port: 'out' },
        { nodeId: effectId!, port: 'in' }
      )
      expect(r.ok).toBe(true)
    })
    expect(result.current.graph.edges).toHaveLength(1)

    // 删除 effect（会级联删除边）
    act(() => { result.current.removeNode(effectId!) })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.edges).toHaveLength(0)

    // undo 应同时恢复 effect 节点和那条边
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(2)
    expect(result.current.graph.nodes.find(n => n.id === effectId)).toBeTruthy()
    expect(result.current.graph.edges).toHaveLength(1)
    expect(result.current.graph.edges[0].from.nodeId).toBe(triggerId!)
    expect(result.current.graph.edges[0].to.nodeId).toBe(effectId!)
  })

  it('6. 失败 connect / 未知 id 的 remove/move/disconnect 不入栈', () => {
    // 前置：1 次成功 add，建立 baseline canUndo=true / past.length=1
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    })
    expect(result.current.canUndo).toBe(true)

    // 失败 connect：目标端口是 output（违反方向 → canConnect 失败）
    // trigger 没有 in 端口，所以自环用 trigger→trigger 端口不存在的方式表达
    act(() => {
      const r = result.current.connect(
        { nodeId: result.current.graph.nodes[0].id, port: 'out' },
        { nodeId: result.current.graph.nodes[0].id, port: 'in' }  // 不存在的端口
      )
      expect(r.ok).toBe(false)
    })
    // 失败 connect 不应入栈
    expect(result.current.canUndo).toBe(true)
    // 还原（1 次 add）：undo 一次应回到空图
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    // redo 回到 1 个节点
    act(() => { result.current.redo() })
    expect(result.current.graph.nodes).toHaveLength(1)

    // 未知节点 remove / move / disconnect：每个都包在 act 里，断言状态不变
    act(() => { result.current.removeNode('does-not-exist') })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.canUndo).toBe(true)

    act(() => { result.current.moveNode('does-not-exist', { x: 0, y: 0 }) })
    expect(result.current.graph.nodes).toHaveLength(1)

    act(() => { result.current.disconnect('does-not-exist') })
    expect(result.current.graph.nodes).toHaveLength(1)

    // 最终：连续 4 次 undo 应能回到最初空图
    // 4 次 = 1 次 add + 3 次失败操作的撤销（失败不入栈，所以实际只需 1 次 undo）
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
  })

  it('7. undo 后新 add 清空 redo', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
      result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'loseHp' })
    })
    expect(result.current.canRedo).toBe(false)

    // undo 一次
    act(() => { result.current.undo() })
    expect(result.current.canRedo).toBe(true)

    // 新 add → redo 栈应清空
    act(() => {
      result.current.addNode('effect', { x: 200, y: 0 }, { kind: 'applyDebuff' })
    })
    expect(result.current.canRedo).toBe(false)

    // 再 undo 一次：应回到只有 1 个节点的状态（不是回到 2 个节点）
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].data).toEqual({ kind: 'gainBuff' })
  })

  it('8. 同一 React batch 内连续 mutation 形成两个独立历史步骤（顺序正确）', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
      result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'loseHp' })
    })
    // 同一 batch 内 2 次 add：历史栈应只有 1 项（2 次 commit 都基于空图，最后只剩 1 个 past entry）
    expect(result.current.canUndo).toBe(true)

    act(() => { result.current.undo() })
    // 回到只有一个节点的状态（不是空图）
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].data).toEqual({ kind: 'gainBuff' })

    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)

    // 顺序 redo：先 add gainBuff，再 add loseHp
    act(() => { result.current.redo() })
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].data).toEqual({ kind: 'gainBuff' })

    act(() => { result.current.redo() })
    expect(result.current.graph.nodes).toHaveLength(2)
  })

  it('9. entityId 变化后图为空，旧图不可 undo/redo', () => {
    const { result, rerender } = renderHook(
      ({ entityId }) => useNodeGraph(entityId, 'relic'),
      { initialProps: { entityId: 'r-1' } }
    )
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
      result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'loseHp' })
    })
    expect(result.current.canUndo).toBe(true)

    // 切换 entity
    act(() => { rerender({ entityId: 'r-2' }) })

    // 新图为空、history 清空
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)

    // undo/redo 在新实体上无操作（不抛错、不变状态）
    act(() => { result.current.undo() })
    act(() => { result.current.redo() })
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)

    // 新实体可以正常 add → undo
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'applyDebuff' })
    })
    expect(result.current.canUndo).toBe(true)
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)
  })

  it('10. history 上限裁剪到 100', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    // 先加一个起始节点（让后面 move 都有意义）
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' }).id
    })

    // 做 120 次 move：每次都会 commit
    act(() => {
      for (let i = 1; i <= 120; i++) {
        result.current.moveNode(nodeId!, { x: i, y: i })
      }
    })

    // React 18 batch 让 setHistory 在 act 内不会刷新 result.current；
    // 每次 undo 单独 act 才能让 canUndo 更新。
    // 总 commit 数 = 1 add + 120 move = 121，past 上限 100，
    // 所以只能 undo 100 次，回到 past[0] = 第 21 次 commit 的 prev（即第 20 次 move 的结果）。
    for (let i = 0; i < 100; i++) {
      act(() => { result.current.undo() })
    }
    expect(result.current.canUndo).toBe(false)

    // 此时位置应停在 (20, 20)：第 20 次 move 的结果。
    // 计算：1 add + 120 moves = 121 commits。past[0] = commit #102 的 prev。
    //   commit #1  prev = emptyGraph（裁掉）
    //   commit #2  prev = graphWithNode（裁掉）
    //   commit #3  prev = moved1（裁掉）
    //   ...
    //   commit #101 切掉 commit #1 的 prev（emptyGraph）→ past = [graphWithNode, ..., moved99]
    //   commit #102 切掉 commit #2 的 prev → past = [moved1, ..., moved100]
    //   ...逐次向后滑动
    //   commit #121 切掉 commit #21 的 prev（即 moved19），past = [moved20, ..., moved119]
    // undo 100 次 → present = past[0] = moved20，位置 (20, 20)
    expect(result.current.graph.nodes[0].position).toEqual({ x: 20, y: 20 })

    // 再 undo 10 次都应是 no-op（past 已空）
    for (let i = 0; i < 10; i++) {
      act(() => { result.current.undo() })
    }
    expect(result.current.graph.nodes[0].position).toEqual({ x: 20, y: 20 })
    expect(result.current.canUndo).toBe(false)
  })

  it('no-op 保持原图引用（无虚假 updatedAt、无虚假历史）', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    const beforeGraph = result.current.graph
    const beforeUpdatedAt = beforeGraph.metadata.updatedAt

    // removeNode 不存在的节点 → graph.ts 返回原图 → commit 视作 no-op
    act(() => { result.current.removeNode('nope') })
    expect(result.current.graph).toBe(beforeGraph)
    expect(result.current.graph.metadata.updatedAt).toBe(beforeUpdatedAt)
    expect(result.current.canUndo).toBe(false)

    // 同样：moveNode 不存在的节点
    act(() => { result.current.moveNode('nope', { x: 1, y: 1 }) })
    expect(result.current.graph).toBe(beforeGraph)
    expect(result.current.canUndo).toBe(false)
  })

  it('undo/redo 自身不产生新历史', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
    })
    expect(result.current.canUndo).toBe(true)

    // undo → 现在 canUndo=false、canRedo=true
    act(() => { result.current.undo() })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    // 多次 undo/redo 都不入栈（no-op）
    act(() => { result.current.undo() })
    act(() => { result.current.undo() })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)

    act(() => { result.current.redo() })
    act(() => { result.current.redo() })  // future 空 → no-op
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('importJson 成功时记录历史；失败时不记录', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
    })
    // 1 次 add → undo 回到空图
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)

    // 构造一个有效的 JSON
    const validJson = result.current.exportJson()
    // 先 add 一个不同的节点让 exportJson 的图 ≠ 空图
    act(() => {
      result.current.addNode('effect', { x: 50, y: 50 }, { kind: 'loseHp' })
    })
    const json2 = result.current.exportJson()
    expect(json2).not.toBe(validJson)

    // 导入 validJson：成功，应记录
    act(() => {
      const r = result.current.importJson(validJson)
      expect(r.ok).toBe(true)
    })
    expect(result.current.canUndo).toBe(true)
    act(() => { result.current.undo() })
    // 回到 importJson 之前
    expect(result.current.graph.nodes).toHaveLength(1)
    expect(result.current.graph.nodes[0].data).toEqual({ kind: 'loseHp' })

    // 失败 importJson：不入栈
    const undoBefore = result.current.canUndo
    act(() => {
      const r = result.current.importJson('not valid json')
      expect(r.ok).toBe(false)
    })
    expect(result.current.canUndo).toBe(undoBefore)
  })
  it('importJson 重复导入同一 JSON 不入栈（Q5 stringify 深比较）', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' })
    })
    const beforeGraph = result.current.graph
    const json = result.current.exportJson()

    act(() => {
      const r = result.current.importJson(json)
      expect(r.ok).toBe(true)
    })

    // deserialize 会返回新对象，但同内容导入仍保持当前引用与历史长度。
    expect(result.current.graph).toBe(beforeGraph)
    expect(result.current.canUndo).toBe(true)
    act(() => { result.current.undo() })
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.canRedo).toBe(true)
  })

  it('historyLimit 合法选项按实例裁剪历史', () => {
    const { result } = renderHook(
      () => useNodeGraph('r-1', 'relic', undefined, { historyLimit: 2 })
    )
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode('effect', { x: 0, y: 0 }, { kind: 'gainBuff' }).id
    })
    act(() => {
      result.current.moveNode(nodeId!, { x: 1, y: 1 })
      result.current.moveNode(nodeId!, { x: 2, y: 2 })
      result.current.moveNode(nodeId!, { x: 3, y: 3 })
    })

    act(() => { result.current.undo() })
    act(() => { result.current.undo() })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.graph.nodes[0].position).toEqual({ x: 1, y: 1 })
  })

  it('historyLimit 非法值开发环境告警并回退默认值', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      renderHook(() => useNodeGraph(
        'r-invalid-limit',
        'relic',
        undefined,
        { historyLimit: 1.5 }
      ))
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('invalid historyLimit=1.5')
      )
    } finally {
      warn.mockRestore()
    }
  })
})

// ============================================================================
// v0.8-3: connectError 生命周期入 hook (Candidate 3)
// 契约:
//   - connectError 默认 null
//   - 成功 connect 不写错误 (且清除之前遗留错误)
//   - 失败 connect 设置 `连线失败：${reason}`
//   - clearConnectError() 把错误清回 null
//   - entity 切换视为新上下文, 清掉遗留错误
// ============================================================================

describe('useNodeGraph connectError 生命周期 (v0.8-3)', () => {
  it('初始 connectError = null, 暴露 clearConnectError', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    expect(result.current.connectError).toBeNull()
    expect(typeof result.current.clearConnectError).toBe('function')
  })

  it('成功 connect 不写错误, 且清除之前的遗留错误', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let trigger: ReturnType<typeof result.current.addNode>
    let effect: ReturnType<typeof result.current.addNode>
    act(() => {
      trigger = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
      effect = result.current.addNode('effect', { x: 100, y: 0 }, { kind: 'gainBuff' })
    })

    // 先制造一次失败 → 错误被设置
    act(() => {
      const r = result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: trigger!.id, port: 'in' }  // 目标端口不存在 → 失败
      )
      expect(r.ok).toBe(false)
    })
    expect(result.current.connectError).toMatch(/^连线失败：/)

    // 再成功 connect → 错误应自动清除
    act(() => {
      const r = result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: effect!.id, port: 'in' }
      )
      expect(r.ok).toBe(true)
    })
    expect(result.current.connectError).toBeNull()
  })

  it('失败 connect 设置 `连线失败：${reason}` 字符串', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let trigger: ReturnType<typeof result.current.addNode>
    act(() => {
      trigger = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    })

    // trigger 没有 in 端口 → connect 试图连到自身不存在的端口 → 失败
    act(() => {
      const r = result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: trigger!.id, port: 'in' }
      )
      expect(r.ok).toBe(false)
    })

    expect(result.current.connectError).toBeTruthy()
    expect(result.current.connectError).toMatch(/^连线失败：/)
    expect(result.current.connectError!.length).toBeGreaterThan(4)
  })

  it('clearConnectError() 把错误清回 null', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let trigger: ReturnType<typeof result.current.addNode>
    act(() => {
      trigger = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    })

    // 制造一次失败
    act(() => {
      result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: trigger!.id, port: 'in' }
      )
    })
    expect(result.current.connectError).toBeTruthy()

    // 主动清除
    act(() => { result.current.clearConnectError() })
    expect(result.current.connectError).toBeNull()
  })

  it('entity 切换视为新上下文, 清掉遗留 connectError', () => {
    const { result, rerender } = renderHook(
      ({ entityId }) => useNodeGraph(entityId, 'relic'),
      { initialProps: { entityId: 'r-1' } }
    )
    let trigger: ReturnType<typeof result.current.addNode>
    act(() => {
      trigger = result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    })
    // 在 r-1 上制造一次失败
    act(() => {
      result.current.connect(
        { nodeId: trigger!.id, port: 'out' },
        { nodeId: trigger!.id, port: 'in' }
      )
    })
    expect(result.current.connectError).toBeTruthy()

    // 切到 r-2 → connectError 应被清掉
    act(() => { rerender({ entityId: 'r-2' }) })
    expect(result.current.connectError).toBeNull()
  })

  it('失败 connect 不入栈 (与 canUndo 状态一致)', () => {
    // 前置: 1 次成功 add 建立 baseline
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    act(() => {
      result.current.addNode('trigger', { x: 0, y: 0 }, { event: 'onCombatStart' })
    })
    expect(result.current.canUndo).toBe(true)

    // 失败 connect → 不入栈, 但 connectError 被设置
    act(() => {
      const r = result.current.connect(
        { nodeId: result.current.graph.nodes[0].id, port: 'out' },
        { nodeId: result.current.graph.nodes[0].id, port: 'in' }
      )
      expect(r.ok).toBe(false)
    })
    expect(result.current.canUndo).toBe(true)  // 仍是 1 次 add 的历史
    expect(result.current.connectError).toBeTruthy()
  })
})

// ============================================================================
// v0.9 (Step 2 — ADR-0006 §决策 §4): palette 按 entityType 过滤
// ============================================================================

describe('useNodeGraph availableTriggers / availableEffects (v0.9 Step 2)', () => {
  it('relic 实体: availableTriggers = 3 个 Relic trigger, availableEffects = 4 个 (3 relic + 1 通用 drawCards)', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    expect(result.current.availableTriggers.sort()).toEqual(
      ['onCardPlayed', 'onCombatStart', 'onTurnStart']
    )
    // 3 relic entity + 1 通用 (drawCards entity 缺省) = 4
    // 注: 截至 v0.9 Step 4, gainBuff/loseHp/gainGold 已标 entity='relic', drawCards 通用
    expect(result.current.availableEffects.sort()).toEqual(
      ['drawCards', 'gainBuff', 'gainGold', 'loseHp']
    )
  })

  it('card 实体: availableTriggers = 4 个 Card trigger, availableEffects = 5 个 (4 card + 1 通用 drawCards)', () => {
    // v0.9 Step 4: Card 4 个 trigger (onPlay / onSelfDraw / onSelfExhaust / onSelfDiscard) 已加入
    const { result } = renderHook(() => useNodeGraph('c-1', 'card'))
    expect(result.current.availableTriggers.sort()).toEqual(
      ['onPlay', 'onSelfDiscard', 'onSelfDraw', 'onSelfExhaust']
    )
    // 4 card entity + 1 通用 (drawCards) = 5
    expect(result.current.availableEffects.sort()).toEqual(
      ['addCardToDeck', 'addCardToHand', 'discardSelf', 'drawCards', 'exhaustSelf']
    )
  })

  it('entityType 切换时 availableTriggers / availableEffects 自动重算', () => {
    const { result, rerender } = renderHook(
      ({ et }: { et: EntityType }) => useNodeGraph('e-1', et),
      { initialProps: { et: 'relic' as EntityType } }
    )

    // 初始 = relic: 3 trigger + 4 effect
    expect(result.current.availableTriggers.length).toBe(3)
    expect(result.current.availableEffects.length).toBe(4)

    // 切到 card: 4 trigger + 5 effect (4 card + 1 通用)
    rerender({ et: 'card' as EntityType })
    expect(result.current.availableTriggers.length).toBe(4)
    expect(result.current.availableEffects.length).toBe(5)

    // 切回 relic: 3 + 4
    rerender({ et: 'relic' as EntityType })
    expect(result.current.availableTriggers.length).toBe(3)
    expect(result.current.availableEffects.length).toBe(4)
  })
})