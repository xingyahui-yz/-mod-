/**
 * Relic 编辑器 - 节点编辑器 v0.4
 *
 * v0.5.2 模块化：从 src/components/RelicEditor.tsx 移至 src/relic/RelicEditor.tsx
 *
 * v0.8-3 (Candidate 3): 编辑器纯展示化 — 删除 `handleConnect` glue 与 `setError('连线失败：'...)` glue.
 *   - 失败 connect 现在由 hook 内部设置 `ng.connectError`（含 '连线失败：' 前缀）
 *   - 成功 connect 自动清除
 *   - 编辑器只在画布下方展示 `ng.connectError`，× 按钮调 `ng.clearConnectError`
 *   - codegen 错误（`handleGenerate` 抛错）仍走本地 `error` state — 不污染 connect 错误
 *
 * v0.4 MVP 范围：
 *  - 表单：id / name / description / tier / rarity
 *  - 节点画布：useNodeGraph + NodeGraphCanvas
 *  - 触发器下拉：添加 trigger 节点（预填 event）
 *  - 效果下拉：添加 effect 节点（预填 kind）
 *  - 生成代码：调用 generateRelicCode → 展示在 textarea
 *
 * v0.4 范围外（后续）：
 *  - 持久化到文件系统（FileService 集成）
 *  - 加载已有 Relic
 *  - AI 生成节点图
 */
import { useState, useCallback, useEffect } from 'react'
import { RelicData } from './RelicData'
import { RelicTier, RelicRarity } from '../types'
import { useNodeGraph } from '../node-editor/useNodeGraph'
import { NodeGraphCanvas } from '../node-editor/NodeGraphCanvas'
import { generateRelicCode } from './codegen'
import { SUPPORTED_TRIGGERS, SUPPORTED_EFFECTS, EFFECT_KINDS } from './kinds'

/**
 * 判断当前键盘事件的目标是否是可编辑文本控件。
 * 是则跳过全局快捷键，让浏览器原生 undo 处理。
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}

interface RelicEditorProps {
  initialRelic?: Partial<RelicData>
}

const TIERS: RelicTier[] = ['Common', 'Uncommon', 'Rare', 'Boss', 'Shop']
const RARITIES: RelicRarity[] = ['Starter', 'Common', 'Uncommon', 'Rare', 'Boss', 'Shop']

export function RelicEditor({ initialRelic }: RelicEditorProps) {
  const [relic, setRelic] = useState<RelicData>({
    id: initialRelic?.id ?? 'my_relic',
    name: initialRelic?.name ?? 'My Relic',
    description: initialRelic?.description ?? '',
    tier: initialRelic?.tier ?? 'Common',
    rarity: initialRelic?.rarity ?? 'Common'
  })
  const [generatedCode, setGeneratedCode] = useState<string>('')
  // v0.8-3 (Candidate 3): 本地 error 只承担 codegen 错误; connect 错误由 hook 拥有.
  const [error, setError] = useState<string>('')

  const ng = useNodeGraph(relic.id, 'relic')

  const handleGenerate = useCallback(() => {
    try {
      const code = generateRelicCode(ng.graph, relic)
      setGeneratedCode(code)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [ng.graph, relic])

  // v0.7: 快捷键 — Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做、Ctrl/Cmd+Y 重做
  // 输入框/textarea/select/contenteditable 焦点时不拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        ng.undo()
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && mod)) {
        // 重做：Cmd/Ctrl+Shift+Z；Ctrl/Cmd+Y 作为别名
        e.preventDefault()
        ng.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ng])

  const addTrigger = (event: string) => {
    ng.addNode('trigger', {
      x: 50 + Math.random() * 200,
      y: 50 + Math.random() * 100
    }, { event })
  }

  const addEffect = (kind: string) => {
    // v0.5.2 part 2：从 kinds.ts 读 defaultData（消除与 codegen EFFECT_DISPATCH 的平行维护）
    const effectKind = EFFECT_KINDS[kind]
    ng.addNode('effect', {
      x: 300 + Math.random() * 200,
      y: 50 + Math.random() * 100
    }, effectKind?.defaultData ?? { kind })
  }

  return (
    <div className="relic-editor" data-testid="relic-editor">
      {/* 左侧：表单 */}
      <div className="relic-form" data-testid="relic-form">
        <h3>📜 Relic 表单</h3>
        <label>
          ID
          <input
            type="text"
            value={relic.id}
            onChange={e => setRelic({ ...relic, id: e.target.value })}
            data-testid="relic-id"
          />
        </label>
        <label>
          显示名
          <input
            type="text"
            value={relic.name}
            onChange={e => setRelic({ ...relic, name: e.target.value })}
            data-testid="relic-name"
          />
        </label>
        <label>
          描述
          <textarea
            value={relic.description}
            onChange={e => setRelic({ ...relic, description: e.target.value })}
            data-testid="relic-description"
          />
        </label>
        <label>
          Tier
          <select
            value={relic.tier}
            onChange={e => setRelic({ ...relic, tier: e.target.value as RelicTier })}
            data-testid="relic-tier"
          >
            {TIERS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Rarity
          <select
            value={relic.rarity}
            onChange={e => setRelic({ ...relic, rarity: e.target.value as RelicRarity })}
            data-testid="relic-rarity"
          >
            {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      </div>

      {/* 中间：节点画布 */}
      <div className="relic-graph" data-testid="relic-graph">
        <div className="graph-toolbar">
          {/* v0.7: 撤销/重做按钮 + 快捷键提示 */}
          <button
            onClick={ng.undo}
            disabled={!ng.canUndo}
            data-testid="undo"
            type="button"
            title="撤销 (Ctrl/Cmd+Z)"
          >
            ↶ 撤销
          </button>
          <button
            onClick={ng.redo}
            disabled={!ng.canRedo}
            data-testid="redo"
            type="button"
            title="重做 (Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y)"
          >
            ↷ 重做
          </button>
          <span className="graph-toolbar-divider">|</span>
          <span>触发器：</span>
          {SUPPORTED_TRIGGERS.map(t => (
            <button
              key={t}
              onClick={() => addTrigger(t)}
              data-testid={`add-trigger-${t}`}
              type="button"
            >
              + {t}
            </button>
          ))}
          <span>效果：</span>
          {SUPPORTED_EFFECTS.map(e => (
            <button
              key={e}
              onClick={() => addEffect(e)}
              data-testid={`add-effect-${e}`}
              type="button"
            >
              + {e}
            </button>
          ))}
          <button
            onClick={handleGenerate}
            data-testid="generate-code"
            type="button"
            className="primary-btn"
          >
            ⚡ 生成代码
          </button>
        </div>
        <NodeGraphCanvas
          graph={ng.graph}
          onMoveNode={ng.moveNode}
          onRemoveNode={ng.removeNode}
          onDisconnect={ng.disconnect}
          onConnect={ng.connect}
        />
        {/* v0.8-3 (Candidate 3): connect 错误由 hook 拥有, 编辑器纯展示 */}
        {ng.connectError && (
          <div className="connect-error" data-testid="connect-error">
            <span>{ng.connectError}</span>
            <button
              onClick={ng.clearConnectError}
              data-testid="connect-error-clear"
              type="button"
              aria-label="关闭连线错误"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* 右侧：预览 */}
      <div className="relic-preview" data-testid="relic-preview">
        <h3>生成的 C# 代码</h3>
        {error && <div className="error" data-testid="relic-error">{error}</div>}
        <textarea
          readOnly
          value={generatedCode}
          placeholder="点「⚡ 生成代码」查看输出"
          data-testid="relic-code"
          rows={20}
        />
      </div>
    </div>
  )
}