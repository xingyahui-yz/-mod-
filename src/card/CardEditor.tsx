/**
 * Card 节点编辑器 (v0.9 Step 4 — ADR-0006 §决策 §7 走法 1)
 *
 * 走法 1 布局：
 *  ┌──────────────────────────────────────────────────────┐
 *  │ 顶部表单横排：ID  Name  Cost  Type  Rarity  Desc Target│
 *  ├──────────────────────────────────────────────────────┤
 *  │ 节点画布：NodeGraphCanvas + 工具栏 (添加 trigger/effect) │
 *  │   - trigger palette: ng.availableTriggers (4 Card)     │
 *  │   - effect  palette: ng.availableEffects (4 Card)     │
 *  ├──────────────────────────────────────────────────────┤
 *  │ 折叠预览: ▶ 生成 C# 代码 (可展开)                     │
 *  │   - 点 [⚡ 生成代码] 渲 card.mustache                  │
 *  │   - 出错显示 codegen error                            │
 *  └──────────────────────────────────────────────────────┘
 *
 * 与 RelicEditor (3-栏布局) 的区别：
 *  - 走法 1 把表单压成顶部横排（不是左侧栏），腾出中间全部给画布
 *  - 预览默认折叠（不是常驻右侧栏），画布获得最大可视空间
 *  - 整体是单列流式布局 (flex-direction: column)
 *
 * Step 6 接入 target 字段在 codegen 里的消费；Step 4 UI 只暴露控件不消费。
 */
import { useState, useCallback, useEffect } from 'react'
import { useNodeGraph } from '../node-editor/useNodeGraph'
import { NodeGraphCanvas } from '../node-editor/NodeGraphCanvas'
import { generateCardCode } from './codegen'
import { CardData, createDefaultCard } from './CardData'
import { EFFECT_KINDS } from '../shared/kinds'

interface CardEditorProps {
  initialCard?: Partial<CardData>
}

const TYPES: CardData['type'][] = ['Attack', 'Skill', 'Power']
const RARITIES: CardData['rarity'][] = ['Common', 'Uncommon', 'Rare']
const TARGETS: CardData['target'][] = ['self', 'eventTarget']

export function CardEditor({ initialCard }: CardEditorProps = {}) {
  const [card, setCard] = useState<CardData>({ ...createDefaultCard(), ...initialCard })
  const [generatedCode, setGeneratedCode] = useState<string>('')
  const [error, setError] = useState<string>('')
  const [previewOpen, setPreviewOpen] = useState(false)

  const ng = useNodeGraph(card.id, 'card')

  const handleGenerate = useCallback(() => {
    try {
      const code = generateCardCode(ng.graph, card)
      setGeneratedCode(code)
      setError('')
      setPreviewOpen(true)  // 生成后自动展开预览
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [ng.graph, card])

  // Ctrl/Cmd+Z 撤销 / Ctrl/Cmd+Shift+Z 重做 (输入控件不拦截)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target.isContentEditable) return
      }
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        ng.undo()
      } else if ((key === 'z' && e.shiftKey) || (key === 'y' && mod)) {
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
    const effectKind = EFFECT_KINDS[kind]
    ng.addNode('effect', {
      x: 300 + Math.random() * 200,
      y: 50 + Math.random() * 100
    }, effectKind?.defaultData ?? { kind })
  }

  const setKeywords = (s: string) => {
    const keywords = s.split(',').map(k => k.trim()).filter(k => k)
    setCard({ ...card, keywords })
  }

  return (
    <div className="card-editor-v9" data-testid="card-editor-v9">
      {/* === 走法 1: 顶部表单横排 === */}
      <div className="card-form-row" data-testid="card-form-row">
        <label>
          <span>ID</span>
          <input
            type="text"
            value={card.id}
            onChange={e => setCard({ ...card, id: e.target.value })}
            data-testid="card-id"
          />
        </label>
        <label>
          <span>名称</span>
          <input
            type="text"
            value={card.name}
            onChange={e => setCard({ ...card, name: e.target.value })}
            data-testid="card-name"
          />
        </label>
        <label>
          <span>费用</span>
          <input
            type="number"
            min={0}
            max={99}
            value={card.cost}
            onChange={e => setCard({ ...card, cost: Number(e.target.value) || 0 })}
            data-testid="card-cost"
          />
        </label>
        <label>
          <span>类型</span>
          <select
            value={card.type}
            onChange={e => setCard({ ...card, type: e.target.value as CardData['type'] })}
            data-testid="card-type"
          >
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          <span>稀有度</span>
          <select
            value={card.rarity}
            onChange={e => setCard({ ...card, rarity: e.target.value as CardData['rarity'] })}
            data-testid="card-rarity"
          >
            {RARITIES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label className="card-target">
          <span>Target (Step 6 接入)</span>
          <select
            value={card.target}
            onChange={e => setCard({ ...card, target: e.target.value as CardData['target'] })}
            data-testid="card-target"
          >
            {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="card-desc">
          <span>描述</span>
          <input
            type="text"
            value={card.description}
            onChange={e => setCard({ ...card, description: e.target.value })}
            data-testid="card-description"
            placeholder="造成 6 点伤害"
          />
        </label>
        <label className="card-keywords">
          <span>关键词 (逗号分隔)</span>
          <input
            type="text"
            value={card.keywords.join(', ')}
            onChange={e => setKeywords(e.target.value)}
            data-testid="card-keywords"
            placeholder="Fire, Damage"
          />
        </label>
      </div>

      {/* === 走法 1: 下部节点画布 === */}
      <div className="card-graph" data-testid="card-graph">
        <div className="graph-toolbar">
          <button
            onClick={ng.undo}
            disabled={!ng.canUndo}
            data-testid="card-undo"
            type="button"
            title="撤销 (Ctrl/Cmd+Z)"
          >
            ↶ 撤销
          </button>
          <button
            onClick={ng.redo}
            disabled={!ng.canRedo}
            data-testid="card-redo"
            type="button"
            title="重做 (Ctrl/Cmd+Shift+Z)"
          >
            ↷ 重做
          </button>
          <span className="graph-toolbar-divider">|</span>
          <span>触发器：</span>
          {/* v0.9 Step 2: 用 hook 返回的 availableTriggers, 不直接 import 列表 */}
          {ng.availableTriggers.map(t => (
            <button
              key={t}
              onClick={() => addTrigger(t)}
              data-testid={`card-add-trigger-${t}`}
              type="button"
            >
              + {t}
            </button>
          ))}
          <span>效果：</span>
          {ng.availableEffects.map(e => (
            <button
              key={e}
              onClick={() => addEffect(e)}
              data-testid={`card-add-effect-${e}`}
              type="button"
            >
              + {e}
            </button>
          ))}
          <button
            onClick={handleGenerate}
            data-testid="card-generate-code"
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
        {ng.connectError && (
          <div className="connect-error" data-testid="card-connect-error">
            <span>{ng.connectError}</span>
            <button
              onClick={ng.clearConnectError}
              data-testid="card-connect-error-clear"
              type="button"
              aria-label="关闭连线错误"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* === 走法 1: 折叠预览 === */}
      <div className="card-preview-fold" data-testid="card-preview-fold">
        <button
          onClick={() => setPreviewOpen(o => !o)}
          data-testid="card-preview-toggle"
          type="button"
          className="preview-toggle"
        >
          {previewOpen ? '▼' : '▶'} 生成 C# 代码
        </button>
        {previewOpen && (
          <div className="card-preview-body" data-testid="card-preview-body">
            {error && <div className="error" data-testid="card-error">{error}</div>}
            <textarea
              readOnly
              value={generatedCode}
              placeholder='点「⚡ 生成代码」查看输出'
              data-testid="card-code"
              rows={20}
            />
          </div>
        )}
      </div>
    </div>
  )
}
