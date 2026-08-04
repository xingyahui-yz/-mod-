/**
 * 节点编辑器组件测试 - v0.3
 * 覆盖：useNodeGraph hook + NodeGraphCanvas 渲染/拖动/删除 + 边渲染 + 点击删除边 + 序列化往返
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useNodeGraph } from './useNodeGraph'
import { NodeGraphCanvas } from './NodeGraphCanvas'
import { createEmptyGraph, connect } from './graph'
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
      result.current.addNode('effect', { x: 100, y: 20 })
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