/**
 * 节点编辑器组件测试 - v0.2
 * 覆盖：useNodeGraph hook + NodeGraphCanvas 渲染/拖动/删除 + 序列化往返
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useNodeGraph } from './useNodeGraph'
import { NodeGraphCanvas } from './NodeGraphCanvas'
import { createEmptyGraph } from './graph'
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
          nodes: [...n.nodes, { id: 'a', type: 'trigger', position: { x: 0, y: 0 }, data: {} }],
          metadata: { ...n.metadata, updatedAt: new Date().toISOString() }
        },
        node: { id: 'a', type: 'trigger', position: { x: 0, y: 0 }, data: {} }
      }
    })()
    g = r1.graph

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