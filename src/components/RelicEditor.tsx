/**
 * Relic 编辑器 - 节点编辑器 v0.4
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
import { useState, useCallback } from 'react'
import { RelicData, RelicTier, RelicRarity } from '../types'
import { useNodeGraph } from '../node-editor/useNodeGraph'
import { NodeGraphCanvas } from '../node-editor/NodeGraphCanvas'
import { generateRelicCode, SUPPORTED_TRIGGERS, SUPPORTED_EFFECTS } from '../node-editor/codegen'

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
    rarity: initialRelic?.rarity ?? 'Common',
    triggers: [],
    graph: undefined
  })
  const [generatedCode, setGeneratedCode] = useState<string>('')
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

  const addTrigger = (event: string) => {
    ng.addNode('trigger', {
      x: 50 + Math.random() * 200,
      y: 50 + Math.random() * 100
    }, { event })
  }

  const addEffect = (kind: string) => {
    const defaults: Record<string, Record<string, unknown>> = {
      gainBuff: { kind: 'gainBuff', buffType: 'Strength', amount: 1 },
      loseHp: { kind: 'loseHp', amount: 1 },
      gainGold: { kind: 'gainGold', amount: 50 },
      drawCards: { kind: 'drawCards', amount: 2 }
    }
    ng.addNode('effect', {
      x: 300 + Math.random() * 200,
      y: 50 + Math.random() * 100
    }, defaults[kind] ?? { kind })
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
        />
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