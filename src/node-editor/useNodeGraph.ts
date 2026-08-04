/**
 * 节点图 React hook - 封装 graph.ts 纯函数到 React state
 */
import { useState, useCallback } from 'react'
import {
  createEmptyGraph, removeNode, moveNode,
  connect, disconnect, serialize, deserialize
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
      // 在 setState updater 之外计算节点 ID，确保同步返回
      const nodeId = crypto.randomUUID()
      const newNode: GraphNode = { id: nodeId, type, position, data }
      setGraph(prev => ({
        ...prev,
        nodes: [...prev.nodes, newNode],
        metadata: { ...prev.metadata, updatedAt: new Date().toISOString() }
      }))
      return newNode
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
      // 基于当前 graph 计算结果（不在 setState updater 里副作用赋值，
      // 否则 React 18 batch 会让 return 早于 updater 执行，导致 stale result）
      const r = connect(graph, from, to)
      if (r.ok) {
        setGraph(r.graph)
        return { ok: true }
      }
      return { ok: false, reason: r.reason }
    },
    [graph]
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