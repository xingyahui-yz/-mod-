import { useState } from 'react'
import { useAIStore } from '../stores/useAIStore'
import { useCardStore } from '../stores/useCardStore'
import { LLM_PROVIDERS, LLMProvider } from '../services/llm/adapters'
import { CardData } from '../types'
import { getTypeColor } from '../utils/cardUtils'

interface AIGeneratorProps {
  onClose?: () => void
}

export function AIGenerator({ onClose }: AIGeneratorProps) {
  const {
    provider,
    apiKey,
    isConfigured,
    isGenerating,
    generatedCards,
    lastError,
    setProvider,
    setApiKey,
    generateCards,
    clearGeneratedCards,
    clearError
  } = useAIStore()

  const { addCardWithData } = useCardStore()

  const [description, setDescription] = useState('')
  const [preferredType, setPreferredType] = useState<CardData['type'] | undefined>(undefined)
  const [showSettings, setShowSettings] = useState(!isConfigured)

  const handleGenerate = async () => {
    clearError()
    await generateCards(description, preferredType)
  }

  const handleSelectCard = (card: CardData) => {
    addCardWithData(card)
    if (onClose) onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleGenerate()
    }
  }

  return (
    <div className="ai-generator">
      <div className="generator-header">
        <h3>✨ AI智能生成卡牌</h3>
        {!showSettings && (
          <button className="settings-btn" onClick={() => setShowSettings(true)}>
            ⚙️
          </button>
        )}
      </div>

      {/* API设置面板 */}
      {showSettings && (
        <div className="settings-panel">
          <div className="form-group">
            <label>选择模型</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as LLMProvider)}
            >
              {LLM_PROVIDERS.map(p => (
                <option key={p.id} value={p.id}>{p.name} - {p.description}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>API Key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="输入你的API密钥"
            />
          </div>

          <button
            className="test-btn"
            onClick={() => setShowSettings(false)}
            disabled={!apiKey.trim()}
          >
            保存配置
          </button>
        </div>
      )}

      {/* 生成输入 */}
      {!showSettings && (
        <>
          <div className="input-section">
            <div className="form-group">
              <label>描述你想要什么样的卡牌</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="例如：一张造成10点伤害的火系攻击牌，或者：一张可以治疗的血量恢复技能"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>偏好类型 (可选)</label>
              <select
                value={preferredType || ''}
                onChange={(e) => setPreferredType(e.target.value as CardData['type'] || undefined)}
              >
                <option value="">不指定</option>
                <option value="Attack">⚔️ 攻击牌</option>
                <option value="Skill">🛡️ 技能牌</option>
                <option value="Power">✨ 力量牌</option>
              </select>
            </div>

            <button
              className="generate-btn"
              onClick={handleGenerate}
              disabled={isGenerating || !description.trim() || !isConfigured}
            >
              {isGenerating ? '🔄 生成中...' : '✨ 生成卡牌'}
            </button>
          </div>

          {/* 错误提示 */}
          {lastError && (
            <div className="error-box">
              ⚠️ {lastError}
              <button className="retry-btn" onClick={clearError}>×</button>
            </div>
          )}

          {/* 生成结果 */}
          {generatedCards.length > 0 && (
            <div className="results-section">
              <h4>生成结果 ({generatedCards.length}张)</h4>
              <p className="hint">点击选择一张卡牌添加到编辑器</p>

              <div className="cards-grid">
                {generatedCards.map((card, index) => (
                  <CardPreview
                    key={index}
                    card={card}
                    onClick={() => handleSelectCard(card)}
                  />
                ))}
              </div>

              <button className="clear-btn" onClick={clearGeneratedCards}>
                清空结果
              </button>
            </div>
          )}
        </>
      )}

      <style>{`
        .ai-generator {
          background: var(--bg-secondary);
          border-radius: 8px;
          overflow: hidden;
        }

        .generator-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border);
        }

        .generator-header h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .settings-btn {
          background: transparent;
          padding: 4px 8px;
          font-size: 16px;
        }

        .settings-panel {
          padding: 16px;
          border-bottom: 1px solid var(--border);
        }

        .form-group {
          margin-bottom: 12px;
        }

        .form-group:last-child {
          margin-bottom: 0;
        }

        .form-group label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--text-secondary);
        }

        .form-group select,
        .form-group input,
        .form-group textarea {
          width: 100%;
        }

        .form-group textarea {
          resize: vertical;
          min-height: 60px;
        }

        .test-btn {
          width: 100%;
          margin-top: 8px;
        }

        .input-section {
          padding: 16px;
        }

        .generate-btn {
          width: 100%;
          margin-top: 8px;
          font-weight: 600;
        }

        .error-box {
          margin: 0 16px 16px;
          padding: 12px;
          background: rgba(233, 69, 96, 0.1);
          border: 1px solid var(--accent);
          border-radius: 6px;
          color: var(--accent);
          font-size: 13px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .retry-btn {
          background: transparent;
          padding: 2px 8px;
          font-size: 16px;
          min-width: auto;
        }

        .results-section {
          padding: 16px;
          border-top: 1px solid var(--border);
        }

        .results-section h4 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 4px 0;
        }

        .results-section .hint {
          font-size: 12px;
          color: var(--text-secondary);
          margin: 0 0 12px 0;
        }

        .cards-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-bottom: 12px;
        }

        .clear-btn {
          width: 100%;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
      `}</style>
    </div>
  )
}

// 卡牌预览组件
function CardPreview({ card, onClick }: { card: CardData; onClick: () => void }) {
  return (
    <div className="card-preview-item" onClick={onClick}>
      <div className="preview-header">
        <span className="preview-name">{card.name}</span>
        <span className="preview-cost" style={{ background: getTypeColor(card.type) }}>
          {card.cost}
        </span>
      </div>
      <div className="preview-meta">
        <span style={{ color: getTypeColor(card.type) }}>{card.type}</span>
        <span className="rarity">{card.rarity}</span>
      </div>
      <div className="preview-desc">{card.description}</div>
      {card.keywords.length > 0 && (
        <div className="preview-keywords">
          {card.keywords.map((k, i) => (
            <span key={i} className="keyword">{k}</span>
          ))}
        </div>
      )}

      <style>{`
        .card-preview-item {
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .card-preview-item:hover {
          border-color: var(--accent);
          transform: translateY(-1px);
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
        }

        .preview-name {
          font-weight: 600;
          font-size: 14px;
        }

        .preview-cost {
          color: white;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: bold;
        }

        .preview-meta {
          display: flex;
          gap: 8px;
          font-size: 11px;
          margin-bottom: 6px;
        }

        .rarity {
          color: var(--text-secondary);
        }

        .preview-desc {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.4;
        }

        .preview-keywords {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 8px;
        }

        .keyword {
          background: rgba(255,255,255,0.1);
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 10px;
          color: var(--text-secondary);
        }
      `}</style>
    </div>
  )
}
