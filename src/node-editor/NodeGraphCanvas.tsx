/**
 * 节点图画布 - 节点编辑器 v0.5
 *
 * - SVG 画布 + 节点用 <g> + <rect> + <text>
 * - 拖动用 mouseDown/move/up + SVG 坐标
 * - 边：贝塞尔曲线 <path>，点击删除
 * - 端口 click-to-connect：
 *   点 output 端口 → 选中 source；点 input 端口 → 触发 onConnect
 *   视觉：选中的端口变白 + 放大
 */
import { useState, useRef, useCallback } from 'react'
import { GraphNode, NodeGraph, PortDef, NODE_PORT_DEFS } from './types'
import { edgePath, NODE_WIDTH, NODE_HEIGHT } from './graph'

export interface PortRef {
  nodeId: string
  port: string
}

interface NodeGraphCanvasProps {
  graph: NodeGraph
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void
  onRemoveNode: (nodeId: string) => void
  onDisconnect?: (edgeId: string) => void
  /** 从 output 端口连到 input 端口 */
  onConnect?: (from: PortRef, to: PortRef) => void
  width?: number
  height?: number
}

const TYPE_COLORS: Record<string, string> = {
  trigger: '#3b82f6',
  condition: '#a855f7',
  effect: '#4ade80',
  branch: '#eab308'
}

export function NodeGraphCanvas({
  graph,
  onMoveNode,
  onRemoveNode,
  onDisconnect,
  onConnect,
  width = 800,
  height = 600
}: NodeGraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<{ nodeId: string; offsetX: number; offsetY: number } | null>(null)
  const [pendingFrom, setPendingFrom] = useState<PortRef | null>(null)

  const screenToSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const inv = ctm.inverse()
    const transformed = pt.matrixTransform(inv)
    return { x: transformed.x, y: transformed.y }
  }, [])

  const handleMouseDown = (e: React.MouseEvent, node: GraphNode) => {
    const svgPt = screenToSvg(e.clientX, e.clientY)
    setDragging({
      nodeId: node.id,
      offsetX: svgPt.x - node.position.x,
      offsetY: svgPt.y - node.position.y
    })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const svgPt = screenToSvg(e.clientX, e.clientY)
    onMoveNode(dragging.nodeId, {
      x: svgPt.x - dragging.offsetX,
      y: svgPt.y - dragging.offsetY
    })
  }

  const handleMouseUp = () => {
    setDragging(null)
  }

  const handleSvgClick = () => {
    // 点击空白 → 取消 pendingFrom
    if (pendingFrom) setPendingFrom(null)
  }

  const handlePortClick = (e: React.MouseEvent, port: PortDef, node: GraphNode) => {
    e.stopPropagation()
    if (port.kind === 'output') {
      // 点 output → 设为 source
      setPendingFrom({ nodeId: node.id, port: port.id })
    } else if (port.kind === 'input' && pendingFrom) {
      // 点 input + 有 pending source → 连线
      onConnect?.(pendingFrom, { nodeId: node.id, port: port.id })
      setPendingFrom(null)
    }
    // 点 input + 无 pending source → no-op
  }

  // 索引节点便于查找
  const nodeIndex = new Map(graph.nodes.map(n => [n.id, n]))

  return (
    <svg
      ref={svgRef}
      className="node-graph-canvas"
      width={width}
      height={height}
      data-testid="node-graph-canvas"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleSvgClick}
    >
      {/* 背景网格 */}
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="url(#grid)" />

      {/* 边：在节点下方渲染 */}
      <g className="edges">
        {graph.edges.map(edge => {
          const fromNode = nodeIndex.get(edge.from.nodeId)
          const toNode = nodeIndex.get(edge.to.nodeId)
          if (!fromNode || !toNode) return null
          const d = edgePath(edge, fromNode, toNode)
          return (
            <path
              key={edge.id}
              data-testid={`edge-${edge.id}`}
              d={d}
              fill="none"
              stroke="var(--accent, #60a5fa)"
              strokeWidth={2}
              style={{ cursor: onDisconnect ? 'pointer' : 'default' }}
              onClick={(e) => {
                e.stopPropagation()
                onDisconnect?.(edge.id)
              }}
            />
          )
        })}
      </g>

      {/* 节点 */}
      {graph.nodes.map(node => (
        <NodeBox
          key={node.id}
          node={node}
          pendingFrom={pendingFrom}
          onMouseDown={(e) => handleMouseDown(e, node)}
          onRemove={() => onRemoveNode(node.id)}
          onPortClick={handlePortClick}
        />
      ))}
    </svg>
  )
}

interface NodeBoxProps {
  node: GraphNode
  pendingFrom: PortRef | null
  onMouseDown: (e: React.MouseEvent) => void
  onRemove: () => void
  onPortClick: (e: React.MouseEvent, port: PortDef, node: GraphNode) => void
}

function NodeBox({ node, pendingFrom, onMouseDown, onRemove, onPortClick }: NodeBoxProps) {
  const color = TYPE_COLORS[node.type] || '#888'
  const ports = NODE_PORT_DEFS[node.type]
  return (
    <g
      data-testid={`node-box-${node.id}`}
      transform={`translate(${node.position.x}, ${node.position.y})`}
      onMouseDown={onMouseDown}
      style={{ cursor: 'move' }}
    >
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={6}
        fill="var(--bg-secondary, #2a2a4a)"
        stroke={color}
        strokeWidth={2}
      />
      <text x={10} y={20} fontSize={12} fill={color} fontWeight="bold">
        {node.type}
      </text>
      <text x={10} y={40} fontSize={10} fill="var(--text-secondary, #aaa)">
        {Object.keys(node.data).join(', ') || '(无数据)'}
      </text>
      {/* 端口 */}
      {ports.map(p => {
        const isPending = pendingFrom?.nodeId === node.id && pendingFrom?.port === p.id
        const isTargetCandidate = !!pendingFrom && p.kind === 'input'
        return (
          <circle
            key={p.id}
            data-testid={`port-${node.id}-${p.id}`}
            cx={p.kind === 'input' ? 0 : NODE_WIDTH}
            cy={15 + ports.indexOf(p) * 12}
            r={isPending ? 6 : 4}
            fill={isPending ? '#ffffff' : color}
            stroke={isTargetCandidate ? '#ffffff' : 'none'}
            strokeWidth={isTargetCandidate ? 2 : 0}
            style={{ cursor: 'pointer' }}
            onClick={(e) => onPortClick(e, p, node)}
          />
        )
      })}
      {/* 删除按钮 */}
      <g
        transform={`translate(${NODE_WIDTH - 18}, 4)`}
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        style={{ cursor: 'pointer' }}
        data-testid={`remove-${node.id}`}
      >
        <circle r={8} fill="rgba(255,0,0,0.3)" />
        <text x={-3} y={3} fontSize={10} fill="white">×</text>
      </g>
    </g>
  )
}