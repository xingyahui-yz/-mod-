/**
 * 节点图 React hook - 封装 graph.ts 纯函数到 React state
 *
 * v0.7：内置 history stack（不可变快照）。
 *   - `graph.ts` 保持纯函数；hook 是历史模块的 seam。
 *   - 每次成功 mutation 若返回新引用，则把旧 present 推入 past、新图成为 present、清空 future。
 *   - 同引用视为 no-op：不入栈、不动 present 引用。
 *   - entity 切换视为新实体，清空历史。
 *   - undo/redo 自身不产生新历史。
 *
 * v0.8-3 (Candidate 3): connectError 生命周期入 hook。
 *   - `connectError: string | null` — 失败原因（带 '连线失败：' 前缀）由 hook 自己拥有
 *   - `clearConnectError()` — 调用方主动清除（例如错误提示的 × 按钮）
 *   - 成功 connect 自动清除 error — 失败的 connect 不入栈，但 error 会被设置
 *   - entity 切换视为新上下文，清除 error
 *   - 编辑器只需观察 + 渲染，不再手动调 `setError('连线失败：' + reason)` 的 glue
 *
 * v0.9 (Step 2 — ADR-0006 §决策 §4): palette 按 entityType 过滤。
 *   - `availableTriggers` / `availableEffects` 用当前 entityType 过滤 shared/kinds.ts
 *   - editor 改用 hook 返回值，不再直接 import SUPPORTED_TRIGGERS/SUPPORTED_EFFECTS
 *   - entity 切换时 React 自动重算（useMemo 依赖 entityType）
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { flushSync } from 'react-dom'
import {
  createEmptyGraph, removeNode, moveNode,
  connect, disconnect, serialize, deserialize,
  buildNode, addNodeToGraph, touchGraph
} from './graph'
import { EntityType, NodeGraph, GraphNode, NodeType } from './types'
import { triggersForEntity, effectsForEntity } from '../shared/kinds'

/** 历史上限：保留最近 100 个 present 之前的快照 */
export const HISTORY_LIMIT = 100

// v0.7：开发环境只提醒一次默认上限；真正的配置入口先留给后续 settings。
if (import.meta.env.DEV && !(globalThis as any).__v07_history_limit_warned) {
  // eslint-disable-next-line no-console
  console.info(
    '[mod-studio v0.7] useNodeGraph HISTORY_LIMIT = 100 (hardcoded). ' +
    'Will be user-configurable in v0.10+ settings. ' +
    'Pass useNodeGraph(id, type, initial?, { historyLimit?: number }) to override.'
  )
  ;(globalThis as any).__v07_history_limit_warned = true
}

/**
 * 不可变历史快照结构
 * - past:    最旧 → 最近一次提交前的图
 * - present: 当前展示的图（与 React state 对外暴露的 graph 同引用）
 * - future:  最近一步可重做 → 最远一步（undo 后产生，commit 时被清空）
 */
export interface HistoryState {
  past: NodeGraph[]
  present: NodeGraph
  future: NodeGraph[]
}

export interface UseNodeGraphReturn {
  graph: NodeGraph
  addNode: (type: NodeType, position: { x: number; y: number }, data?: Record<string, unknown>) => GraphNode
  removeNode: (nodeId: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  connect: (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => { ok: boolean; reason?: string }
  disconnect: (edgeId: string) => void
  exportJson: () => string
  importJson: (json: string) => { ok: boolean; error?: string }
  /** v0.7：撤销/重做 */
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** v0.8-3 (Candidate 3): connectError 生命周期 — hook 拥有 */
  connectError: string | null
  clearConnectError: () => void
  /** v0.9 (Step 2 — ADR-0006 §决策 §4): 当前 entityType 的 trigger 列表 (palette 用) */
  availableTriggers: string[]
  /** v0.9 (Step 2 — ADR-0006 §决策 §4): 当前 entityType 的 effect 列表 (palette 用) */
  availableEffects: string[]
}

export interface UseNodeGraphOptions {
  historyLimit?: number
}

function resolveHistoryLimit(options?: UseNodeGraphOptions): number {
  const value = options?.historyLimit
  if (value === undefined) return HISTORY_LIMIT
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mod-studio] useNodeGraph: invalid historyLimit=${value}, fallback to ${HISTORY_LIMIT}`
      )
    }
    return HISTORY_LIMIT
  }
  return value
}

/**
 * 提交流水线：给定旧 history 与新 present，返回新 history。
 * - next === prev.present：no-op，原样返回（保持引用相等 → 不触发 setGraph 引用变化 →
 *   不产生虚假 updatedAt、不入栈）。
 * - 否则：旧 present 入 past（裁剪到 HISTORY_LIMIT），设新 present，清空 future。
 */
function commit(
  prev: HistoryState,
  next: NodeGraph,
  historyLimit: number = HISTORY_LIMIT
): HistoryState {
  if (next === prev.present) return prev
  const basePast = prev.past.length >= historyLimit
    ? prev.past.slice(prev.past.length - historyLimit + 1)
    : prev.past
  return {
    past: [...basePast, prev.present],
    present: next,
    future: []
  }
}

export function useNodeGraph(
  entityId: string,
  entityType: EntityType,
  initial?: NodeGraph,
  options?: UseNodeGraphOptions
): UseNodeGraphReturn {
  const [historyLimit] = useState(() => resolveHistoryLimit(options))
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: initial ?? createEmptyGraph(entityId, entityType),
    future: []
  }))
  // v0.8-3 (Candidate 3): connectError 入 hook. 成功 connect 自动清除,
  // entity 切换视为新上下文清除. 编辑器纯展示.
  const [connectError, setConnectError] = useState<string | null>(null)

  // The initializer only runs on mount. Track identity separately so a
  // subsequent entity switch cannot keep editing the previous graph, while
  // preserving the optional initial graph on the first render.
  const identityRef = useRef(`${entityType}:${entityId}`)
  useEffect(() => {
    const identity = `${entityType}:${entityId}`
    if (identityRef.current === identity) return
    identityRef.current = identity
    setHistory({
      past: [],
      present: createEmptyGraph(entityId, entityType),
      future: []
    })
    // entity 切换视为新上下文, 清掉遗留 connectError
    setConnectError(null)
  }, [entityId, entityType])

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }, data: Record<string, unknown> = {}): GraphNode => {
      // v0.5.1: 用 graph.ts 公开纯函数（buildNode + addNodeToGraph + touchGraph）
      // 同步返回新节点；setState updater 用 prev，保证同一 render 多次 add 不丢
      const node = buildNode(type, position, data)
      setHistory(prev => commit(prev, touchGraph(addNodeToGraph(prev.present, node)), historyLimit))
      return node
    },
    [historyLimit]
  )

  const removeNodeFn = useCallback((nodeId: string) => {
    // graph.ts 在节点不存在时短路返回原图 → commit 自动 no-op（不入栈）
    setHistory(prev => commit(prev, removeNode(prev.present, nodeId), historyLimit))
  }, [historyLimit])

  const moveNodeFn = useCallback((nodeId: string, position: { x: number; y: number }) => {
    setHistory(prev => commit(prev, moveNode(prev.present, nodeId, position), historyLimit))
  }, [historyLimit])

  const connectFn = useCallback(
    (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => {
      // v0.6: 改纯 updater 形式，避免同一 tick 多次连读连写不一致。
      // v0.7: 失败时 commit 直接返回 prev（不入栈）。
      // v0.8-3 (Candidate 3): connectError 生命周期入 hook — 成功清除, 失败设置.
      // React 18 batch 内 setState updater **不是**同步执行；这里要同步读 outcome，
      // 所以用 flushSync 包一层。flushSync 是 React 官方推荐的"同步执行 updater"方式，
      // 代价是同一 tick 触发一次同步 re-render（编辑器交互下可接受）。
      let outcome: { ok: true } | { ok: false; reason: string } = { ok: true }
      flushSync(() => {
        setHistory(prev => {
          const r = connect(prev.present, from, to)
          if (r.ok) {
            outcome = { ok: true }
            setConnectError(null)  // 成功 connect 自动清除
            return commit(prev, r.graph, historyLimit)
          }
          outcome = r
          setConnectError(`连线失败：${r.reason}`)  // 失败设置可读错误
          return prev  // 失败不入栈（connect 已返回原 prev.present）
        })
      })
      return outcome
    },
    [historyLimit]
  )

  const disconnectFn = useCallback((edgeId: string) => {
    setHistory(prev => commit(prev, disconnect(prev.present, edgeId), historyLimit))
  }, [historyLimit])

  const exportJson = useCallback(() => serialize(history.present), [history.present])

  const importJson = useCallback((json: string) => {
    try {
      const restored = deserialize(json)
      setHistory(prev => {
        if (restored === prev.present) return prev
        // deserialize 每次都会产生新引用；同内容导入仍视为 no-op，避免虚假历史。
        if (JSON.stringify(restored) === JSON.stringify(prev.present)) return prev
        return commit(prev, restored, historyLimit)
      })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }, [historyLimit])

  // v0.7: undo / redo
  // - 自身不入栈（直接 setHistory，不走 commit）
  // - past / future 空时为 no-op（返回 prev，引用不变 → React 不重渲染）
  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.past.length === 0) return prev
      const last = prev.past[prev.past.length - 1]
      return {
        past: prev.past.slice(0, -1),
        present: last,
        future: [prev.present, ...prev.future]
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory(prev => {
      if (prev.future.length === 0) return prev
      const next = prev.future[0]
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: prev.future.slice(1)
      }
    })
  }, [])

  const clearConnectError = useCallback(() => {
    setConnectError(null)
  }, [])

  // v0.9 (Step 2): palette 按当前 entityType 过滤。entity 切换自动重算
  // （依赖 entityType，useMemo 失效重算 → 引用变化 → 编辑器 React 子树自动重渲染）
  const availableTriggers = useMemo(
    () => triggersForEntity(entityType),
    [entityType]
  )
  const availableEffects = useMemo(
    () => effectsForEntity(entityType),
    [entityType]
  )

  return {
    graph: history.present,
    addNode,
    removeNode: removeNodeFn,
    moveNode: moveNodeFn,
    connect: connectFn,
    disconnect: disconnectFn,
    exportJson,
    importJson,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    // v0.8-3 (Candidate 3): connectError 生命周期 seam
    connectError,
    clearConnectError,
    // v0.9 (Step 2): entityType 过滤的 palette
    availableTriggers,
    availableEffects,
  }
}