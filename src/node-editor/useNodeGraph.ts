/**
 * 节点图 React hook - 封装 graph.ts 纯函数到 React state
 */
import { useState, useCallback } from 'react'
import { flushSync } from 'react-dom'
import {
  createEmptyGraph, removeNode, moveNode,
  connect, disconnect, serialize, deserialize,
  buildNode, addNodeToGraph, touchGraph
} from './graph'
import { EntityType, NodeGraph, GraphNode, NodeType } from './types'

export interface UseNodeGraphReturn {
  graph: NodeGraph
  addNode: (type: NodeType, position: { x: number; y: number }, data?: Record<string, unknown>) => GraphNode
  removeNode: (nodeId: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  connect: (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => { ok: boolean; reason?: string }
  disconnect: (edgeId: string) => void
  exportJson: () => string
  importJson: (json: string) => { ok: boolean; error?: string }
}

export function useNodeGraph(
  entityId: string,
  entityType: EntityType,
  initial?: NodeGraph
): UseNodeGraphReturn {
  const [graph, setGraph] = useState<NodeGraph>(
    () => initial ?? createEmptyGraph(entityId, entityType)
  )

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }, data: Record<string, unknown> = {}): GraphNode => {
      // v0.5.1: 用 graph.ts 公开纯函数（buildNode + addNodeToGraph + touchGraph）
      // 同步返回新节点；setState updater 用 prev，保证同一 render 多次 add 不丢
      const node = buildNode(type, position, data)
      setGraph(prev => touchGraph(addNodeToGraph(prev, node)))
      return node
    },
    []
  )

  const removeNodeFn = useCallback((nodeId: string) => {
    setGraph(prev => removeNode(prev, nodeId))
  }, [])

  const moveNodeFn = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setGraph(prev => moveNode(prev, nodeId, position))
  }, [])

  const connectFn = useCallback(
    (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => {
      // v0.6: 改纯 updater 形式，避免同一 tick 多次连读连写不一致。
      // 不依赖外部 graph 闭包；connect 在 setGraph 的 prev 上算，prev 是最新状态。
      // outcome 在闭包内捕获，返回给调用方。React 18 batch 内 updater 同步执行。
      let outcome: { ok: true } | { ok: false; reason: string } = { ok: true }
      flushSync(() => {
        setGraph(prev => {
          const r = connect(prev, from, to)
          if (r.ok) return r.graph
          outcome = r
          return prev
        })
      })
      return outcome
    },
    []
  )

  const disconnectFn = useCallback((edgeId: string) => {
    setGraph(prev => disconnect(prev, edgeId))
  }, [])

  const exportJson = useCallback(() => serialize(graph), [graph])

  const importJson = useCallback((json: string) => {
    try {
      const restored = deserialize(json)
      setGraph(restored)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [])

  return {
    graph,
    addNode,
    removeNode: removeNodeFn,
    moveNode: moveNodeFn,
    connect: connectFn,
    disconnect: disconnectFn,
    exportJson,
    importJson
  }
}