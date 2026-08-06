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
import { NodeGraph } from './types'

describe('useNodeGraph hook', () => {
  it('默认创建空图', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    expect(result.current.graph.nodes).toHaveLength(0)
    expect(result.current.graph.entityId).toBe('r-1')
    expect(result.current.graph.entityType).toBe('relic')
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
  it('connect 失败时返回 {ok:false, reason}（v0.6 closure bug 修复）', () => {
    const { result } = renderHook(() => useNodeGraph('r-1', 'relic'))
    let nodeId: string
    act(() => {
      nodeId = result.current.addNode(
        'trigger',
        { x: 0, y: 0 },
        { event: 'onCombatStart' }
      ).id
    })

    const r = result.current.connect(
      { nodeId: nodeId!, port: 'out' },
      { nodeId: nodeId!, port: 'in' }
    )
    expect(r.ok).toBe(false)
    expect((r as { ok: false; reason: string }).reason).toBeTruthy()
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