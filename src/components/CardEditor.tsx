import { useState, useEffect, useMemo, useRef } from 'react'
import { useCardStore } from '../stores/useCardStore'
import { CardData, createDefaultCard } from '../types'
import { generateCardDocumentCode } from '../card/codegen'
import { isValidCardId, validateCard } from '../card/cardValidation'
import { getTypeColor } from '../utils/cardUtils'
import { CardIOButtons } from './CardIOButtons'
import { CardSearch } from './CardSearch'
import { Toast } from './Toast'
import { useTransientMessage } from '../hooks/useTransientMessage'
import * as FileService from '../services/FileService'
import { NodeGraphCanvas } from '../node-editor/NodeGraphCanvas'
import { appendNode, connect, disconnect, moveNode, removeNode } from '../node-editor/graph'
import type { NodeGraph } from '../node-editor/types'
import { effectsForEntity, triggersForEntity, EFFECT_KINDS } from '../shared/kinds'
import { serializeCardDocument } from '../card/cardDocument'

interface CardEditorProps {
  projectPath: string | null
}

export function CardEditor({ projectPath }: CardEditorProps) {
  const {
    cards,
    currentCard,
    currentDocument,
    selectedCardId,
    updateCard,
    addCardWithData,
    deleteCard,
    selectCard,
    loadCardDocuments,
    undoCard,
    redoCard,
    canUndoCard,
    canRedoCard,
    updateGraph,
    setGeneratedDocument,
  } = useCardStore()

  const [generatedCode, setGeneratedCode] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const { message: saveMessage, showMessage: showSaveMessage } = useTransientMessage()
  const { message: loadMessage, showMessage: showLoadMessage } = useTransientMessage()
  const [errors, setErrors] = useState<string[]>([])
  const [loadingCards, setLoadingCards] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | CardData['type']>('all')
  const [graph, setGraph] = useState<NodeGraph | null>(null)
  const [graphError, setGraphError] = useState<string | null>(null)
  const [autosaveState, setAutosaveState] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle')
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistedSnapshot = useRef<string | null>(null)
  const [showCreateIdDialog, setShowCreateIdDialog] = useState(false)
  const [newCardId, setNewCardId] = useState('NewCard')

  useEffect(() => {
    setGraph(currentDocument?.graph ?? null)
    setGraphError(null)
  }, [currentDocument])

  // Card 属性与行为图共享同一份防抖草稿自动保存；generation 指纹随编辑
  // 失效但不会在这里生成 C#。effect cleanup 会在切换 Card/项目或卸载前
  // 尽力 flush 当前待保存快照，避免用户快速切换丢失最后一次编辑。
  useEffect(() => {
    if (autosaveTimer.current) {
      clearTimeout(autosaveTimer.current)
      autosaveTimer.current = null
    }
    if (!projectPath || !currentDocument) {
      persistedSnapshot.current = null
      setAutosaveState('idle')
      return
    }

    const snapshot = serializeCardDocument(currentDocument)
    if (persistedSnapshot.current === null) {
      persistedSnapshot.current = snapshot
      setAutosaveState('saved')
      return
    }
    if (persistedSnapshot.current === snapshot) return

    setAutosaveState('pending')
    const documentToSave = currentDocument
    const projectToSave = projectPath
    const flush = async () => {
      setAutosaveState('saving')
      const result = await FileService.saveCardDocument(projectToSave, documentToSave)
      if (result.ok) {
        persistedSnapshot.current = snapshot
        setAutosaveState('saved')
      } else {
        setAutosaveState('error')
      }
    }
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null
      void flush()
    }, 500)

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
        // 不等待 Promise，先启动写入；Electron 文件端口会自行完成原子写。
        void flush()
      }
    }
  }, [projectPath, currentDocument])

  // 当项目路径变化时，加载现有卡牌
  useEffect(() => {
    if (projectPath) {
      loadExistingCards()
    }
  }, [projectPath])

  // 加载项目中现有的卡牌
  const loadExistingCards = async () => {
    if (!projectPath) return

    setLoadingCards(true)
    // 项目切换先清空旧项目投影，避免加载失败时串出上一项目的 Card。
    loadCardDocuments([])
    try {
      const entries = await FileService.loadCardDocuments(projectPath)
      const editableDocuments = entries
        .filter(entry => entry.result.status === 'editable')
        .map(entry => entry.result.status === 'editable' ? entry.result.document : null)
        .filter((document): document is NonNullable<typeof document> => document !== null)
      const invalidEntries = entries.filter(entry => entry.result.status !== 'editable')
      loadCardDocuments(editableDocuments)
      if (invalidEntries.length > 0) {
        showLoadMessage('error', `${invalidEntries.length} 张 Card 无法编辑，已隔离并保留原文件`)
      }
    } catch (err) {
      console.error('Failed to load existing cards:', err)
      showLoadMessage('error', `加载卡牌失败: ${err instanceof Error ? err.message : String(err)}`)
    }
    setLoadingCards(false)
  }

  // 过滤卡牌 - 单一useMemo，同时保留原始索引，避免每次渲染O(n²)的findIndex
  const filteredCards = useMemo(() => {
    let result = cards.map((card, originalIndex) => ({ card, originalIndex }))

    if (typeFilter !== 'all') {
      result = result.filter(({ card }) => card.type === typeFilter)
    }

    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      result = result.filter(({ card }) =>
        card.name.toLowerCase().includes(term) ||
        card.description.toLowerCase().includes(term) ||
        card.keywords.some(k => k.toLowerCase().includes(term))
      )
    }

    return result
  }, [cards, searchTerm, typeFilter])

  // 处理卡牌属性变化
  const handleCardChange = (field: keyof CardData, value: string | number | string[]) => {
    if (selectedCardId === null) return
    updateCard(selectedCardId, { [field]: value })
    setErrors([]) // 清除错误
  }

  // 处理关键词变化
  const handleKeywordsChange = (value: string) => {
    if (selectedCardId === null) return
    const keywords = value.split(',').map(k => k.trim()).filter(k => k)
    updateCard(selectedCardId, { keywords })
  }

  const applyGraph = (next: NodeGraph) => {
    if (!selectedCardId) return
    setGraph(next)
    updateGraph(selectedCardId, next)
  }

  const handleDeleteCard = async (cardId: string) => {
    if (!projectPath) {
      deleteCard(cardId)
      return
    }
    const document = useCardStore.getState().documents.find(item => item.card.id === cardId)
    if (!document) return
    // 删除前先 flush 权威 CardDocument，再把文档和活动 C# 一起移入回收站。
    const saved = await FileService.saveCardDocument(projectPath, document)
    if (!saved.ok) {
      showLoadMessage('error', `删除失败：${saved.error}`)
      return
    }
    const removed = await FileService.deleteCardToTrash(projectPath, cardId)
    if (removed.status !== 'deleted') {
      showLoadMessage('error', `删除失败：${removed.reason}`)
      return
    }
    deleteCard(cardId)
  }

  const openCreateCard = () => {
    setNewCardId('NewCard')
    setErrors([])
    setShowCreateIdDialog(true)
  }

  const confirmCreateCard = () => {
    if (!isValidCardId(newCardId)) {
      setErrors(['Card ID 必须是以英文字母开头的 PascalCase ASCII 标识符'])
      return
    }
    const created = addCardWithData({ ...createDefaultCard(), id: newCardId })
    if (!created) {
      setErrors([`Card ID ${newCardId} 已存在，请确认一个新的 ID`])
      return
    }
    setShowCreateIdDialog(false)
  }

  const addTrigger = (event: string) => {
    if (!graph) return
    applyGraph(appendNode(graph, 'trigger', { x: 50 + graph.nodes.length * 24, y: 50 }, { event }).graph)
  }

  const addEffect = (kind: string) => {
    if (!graph) return
    const definition = EFFECT_KINDS[kind]
    applyGraph(appendNode(graph, 'effect', { x: 280 + graph.nodes.length * 24, y: 50 }, definition?.defaultData ?? { kind }).graph)
  }

  const handleConnect = (from: { nodeId: string; port: string }, to: { nodeId: string; port: string }) => {
    if (!graph) return
    const result = connect(graph, from, to)
    if (!result.ok) {
      setGraphError(`连线失败：${result.reason}`)
      return
    }
    setGraphError(null)
    applyGraph(result.graph)
  }

  // 预览生成的代码
  const handlePreview = () => {
    if (!currentCard) return

    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    try {
      if (!currentDocument) throw new Error('CardDocument 尚未加载')
      const code = generateCardDocumentCode(currentDocument, 'MyMod.Cards')
      setGeneratedCode(code)
      setErrors([])
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    }
  }

  const handleGenerateArtifact = async () => {
    if (!projectPath || !currentCard || !currentDocument) return
    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }
    setSaving(true)
    setErrors([])
    try {
      // 先保存源数据，再显式生成 C#；自动保存不会触发此路径。
      const saved = await FileService.saveCardDocument(projectPath, currentDocument)
      if (!saved.ok) {
        setErrors([saved.error])
        return
      }
      let result = await FileService.generateCardArtifact(projectPath, currentDocument)
      if (result.status === 'blocked') {
        const confirmed = typeof window !== 'undefined' && window.confirm('检测到外部 C# 修改。是否先备份外部版本并重新生成？')
        if (confirmed) {
          const backup = await FileService.backupCardArtifact(projectPath, currentDocument.card.id)
          if (!backup.ok) {
            setErrors([backup.error])
            return
          }
          result = await FileService.generateCardArtifact(projectPath, currentDocument, { allowExternalOverwrite: true })
        }
      }
      if (result.status === 'generated') {
        setGeneratedDocument(result.document)
        setGeneratedCode(generateCardDocumentCode(result.document, 'MyMod.Cards'))
        showSaveMessage('success', `已生成 C#：${result.path}`)
      } else if (result.status === 'blocked') {
        setErrors([`检测到${result.reason === 'external-modification' ? '外部修改' : '未跟踪'}的 C#，请先备份/导出后再确认重生成`])
      } else {
        setErrors([result.reason])
      }
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    } finally {
      setSaving(false)
    }
  }

  // 保存卡牌到项目
  const handleSave = async () => {
    if (!projectPath || !currentCard || !currentDocument) return

    const validationErrors = validateCard(currentCard)
    if (validationErrors.length > 0) {
      setErrors(validationErrors)
      return
    }

    setSaving(true)
    setErrors([])

    try {
      const result = await FileService.saveCardDocument(projectPath, currentDocument)

      if (result.ok) {
        persistedSnapshot.current = serializeCardDocument(currentDocument)
        setAutosaveState('saved')
        showSaveMessage('success', `已保存到 ${result.path}`)
      } else {
        setErrors([result.error || '保存失败，请检查目录权限'])
      }
    } catch (err) {
      setErrors([`保存失败: ${err}`])
    }

    setSaving(false)
  }

  // 生成描述预览
  const getDescriptionPreview = () => {
    if (!currentCard) return ''
    return currentCard.description || '卡牌描述'
  }

  // 获取费用显示
  const getCostDisplay = () => {
    if (!currentCard) return '?'
    return currentCard.cost.toString()
  }

  return (
    <div className="card-editor">
      <div className="editor-header">
        <h2>🃏 卡牌编辑器</h2>
        <div className="header-actions">
          {loadingCards && <span className="loading-text">加载中...</span>}
          <CardIOButtons />
          {autosaveState === 'pending' && <span className="loading-text">草稿待保存</span>}
          {autosaveState === 'saving' && <span className="loading-text">自动保存中...</span>}
          {autosaveState === 'saved' && <span className="loading-text">草稿已保存</span>}
          {autosaveState === 'error' && <span className="error-text">自动保存失败</span>}
          <button onClick={undoCard} disabled={!canUndoCard} title="撤销 Card 编辑">↶ 撤销</button>
          <button onClick={redoCard} disabled={!canRedoCard} title="重做 Card 编辑">↷ 重做</button>
          <button onClick={openCreateCard}>+ 新建卡牌</button>
        </div>
      </div>

      <div className="editor-content">
        {/* 左侧：卡牌列表 */}
        <div className="card-list">
          {cards.length === 0 ? (
            <div className="empty-list">
              <p>暂无卡牌</p>
              <button onClick={openCreateCard}>创建第一张卡牌</button>
            </div>
          ) : (
            <>
              <CardSearch
                searchTerm={searchTerm}
                typeFilter={typeFilter}
                filteredCount={filteredCards.length}
                totalCount={cards.length}
                onSearchTermChange={setSearchTerm}
                onTypeFilterChange={setTypeFilter}
              />
              {filteredCards.map(({ card }) => (
              <div
                key={card.id}
                className={`card-item ${selectedCardId === card.id ? 'selected' : ''}`}
                onClick={() => selectCard(card.id)}
              >
                <div className="card-mini-preview">
                  <span className="mini-cost">{card.cost}</span>
                  <span
                    className="mini-type"
                    style={{ color: getTypeColor(card.type) }}
                  >
                    {card.type.charAt(0)}
                  </span>
                </div>
                <span className="card-name">{card.name || '未命名'}</span>
                <button
                  className="delete-btn"
                  onClick={(e) => { e.stopPropagation(); void handleDeleteCard(card.id); }}
                >
                  ×
                </button>
              </div>
                )
              )}
            </>
          )}
        </div>

        {/* 右侧：卡牌属性编辑 */}
        <div className="card-properties">
          {currentCard ? (
            <>
              {/* 卡片预览 */}
              <div className="card-preview" style={{ '--type-color': getTypeColor(currentCard.type) } as React.CSSProperties}>
                <div className="preview-header">
                  <span className="preview-name">{currentCard.name || '卡牌名称'}</span>
                  <span className="preview-cost">{getCostDisplay()}</span>
                </div>
                <div className="preview-type" style={{ color: getTypeColor(currentCard.type) }}>
                  {currentCard.type}
                </div>
                <div className="preview-rarity">
                  {currentCard.rarity}
                </div>
                <div className="preview-description">
                  {getDescriptionPreview()}
                </div>
                {currentCard.keywords.length > 0 && (
                  <div className="preview-keywords">
                    {currentCard.keywords.map((k, i) => (
                      <span key={i} className="keyword-tag">{k}</span>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-section">
                <h3>基本信息</h3>

                <div className="form-row">
                  <label>卡牌名称</label>
                  <input
                    type="text"
                    value={currentCard.name}
                    onChange={(e) => handleCardChange('name', e.target.value)}
                    placeholder="例如：火球术"
                  />
                </div>

                <div className="form-row-inline">
                  <div className="form-row half">
                    <label>费用</label>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={currentCard.cost}
                      onChange={(e) => handleCardChange('cost', parseInt(e.target.value) || 0)}
                    />
                  </div>

                  <div className="form-row half">
                    <label>稀有度</label>
                    <select
                      value={currentCard.rarity}
                      onChange={(e) => handleCardChange('rarity', e.target.value)}
                    >
                      <option value="Common">普通</option>
                      <option value="Uncommon">优秀</option>
                      <option value="Rare">稀有</option>
                    </select>
                  </div>
                </div>

                <div className="form-row">
                  <label>类型</label>
                  <select
                    value={currentCard.type}
                    onChange={(e) => handleCardChange('type', e.target.value)}
                  >
                    <option value="Attack">⚔️ 攻击 (Attack)</option>
                    <option value="Skill">🛡️ 技能 (Skill)</option>
                    <option value="Power">✨ 力量 (Power)</option>
                  </select>
                </div>
              </div>

              <div className="form-section">
                <h3>效果</h3>

                <div className="form-row">
                  <label>描述</label>
                  <textarea
                    value={currentCard.description}
                    onChange={(e) => handleCardChange('description', e.target.value)}
                    placeholder="例如：造成6点伤害。"
                    rows={3}
                  />
                </div>

                <div className="form-row">
                  <label>关键词 (逗号分隔)</label>
                  <input
                    type="text"
                    value={currentCard.keywords.join(', ')}
                    onChange={(e) => handleKeywordsChange(e.target.value)}
                    placeholder="例如：Fire, Damage"
                  />
                </div>
              </div>

              {/* 错误提示 */}
              {errors.length > 0 && (
                <div className="error-box">
                  {errors.map((err, i) => (
                    <div key={i} className="error-item">⚠️ {err}</div>
                  ))}
                </div>
              )}

              {graph && (
                <div className="card-node-editor" data-testid="card-node-editor">
                  <div className="node-toolbar">
                    <span>行为图</span>
                    {triggersForEntity('card').map(event => (
                      <button key={event} type="button" onClick={() => addTrigger(event)}>
                        + {event}
                      </button>
                    ))}
                    {effectsForEntity('card').map(kind => (
                      <button key={kind} type="button" onClick={() => addEffect(kind)}>
                        + {kind}
                      </button>
                    ))}
                  </div>
                  <NodeGraphCanvas
                    graph={graph}
                    onMoveNode={(nodeId, position) => applyGraph(moveNode(graph, nodeId, position))}
                    onRemoveNode={(nodeId) => applyGraph(removeNode(graph, nodeId))}
                    onDisconnect={(edgeId) => applyGraph(disconnect(graph, edgeId))}
                    onConnect={handleConnect}
                    width={720}
                    height={360}
                  />
                  {graphError && <div className="error-box" data-testid="card-graph-error">⚠️ {graphError}</div>}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="form-actions">
                <button onClick={handlePreview} className="preview-btn">
                  👁️ 预览代码
                </button>
                <button
                  onClick={() => void handleGenerateArtifact()}
                  className="preview-btn"
                  disabled={saving || !projectPath}
                >
                  ⚡ 生成 C#
                </button>
                <button
                  onClick={handleSave}
                  className="save-btn"
                  disabled={saving || !projectPath}
                >
                  {saving ? '保存中...' : '💾 保存到项目'}
                </button>
              </div>

              {saveMessage && <Toast message={saveMessage} />}
            </>
          ) : (
            <div className="no-selection">
              <div className="empty-card-icon">🃏</div>
              <p>选择一张卡牌进行编辑</p>
              <p>或点击「新建卡牌」创建</p>
            </div>
          )}
        </div>

        {/* 加载错误 Toast：放在 card-properties 之外，不受 currentCard 影响 */}
        {loadMessage && <Toast message={loadMessage} />}

        {/* 下方：代码预览 */}
        {generatedCode && (
          <div className="code-preview">
            <div className="code-header">
              <span>📄 生成的C#代码</span>
              <button onClick={() => setGeneratedCode('')}>关闭</button>
            </div>
            <pre>
              <code>{generatedCode}</code>
            </pre>
          </div>
        )}
      </div>

      {showCreateIdDialog && (
        <div className="card-id-dialog" role="dialog" aria-label="确认 Card ID" data-testid="card-id-dialog">
          <div className="card-id-dialog-body">
            <h3>确认 Card ID</h3>
            <p>Card ID 创建后不可修改，并决定文档、类名和 C# 文件名。</p>
            <input
              value={newCardId}
              onChange={(event) => setNewCardId(event.target.value)}
              autoFocus
              data-testid="new-card-id-input"
              aria-label="Card ID"
            />
            <div className="card-id-dialog-actions">
              <button onClick={confirmCreateCard}>确认创建</button>
              <button onClick={() => setShowCreateIdDialog(false)}>取消</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .card-editor {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-secondary);
          border-radius: 8px;
          overflow: hidden;
        }

        .card-id-dialog {
          position: fixed;
          inset: 0;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.45);
          z-index: 20;
        }

        .card-id-dialog-body {
          width: min(420px, calc(100vw - 32px));
          padding: 20px;
          border-radius: 8px;
          background: var(--bg-secondary);
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
        }

        .card-id-dialog-body h3,
        .card-id-dialog-body p {
          margin-top: 0;
        }

        .card-id-dialog-body input {
          width: 100%;
        }

        .card-id-dialog-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 16px;
        }

        .editor-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border);
        }

        .editor-header h2 {
          font-size: 16px;
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .loading-text {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .editor-content {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        /* 卡牌列表 */
        .card-list {
          width: 200px;
          border-right: 1px solid var(--border);
          overflow-y: auto;
          padding: 8px;
        }

        .empty-list {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .empty-list button {
          margin-top: 12px;
        }

        .card-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s;
          position: relative;
        }

        .card-item:hover {
          background: var(--bg-tertiary);
        }

        .card-item.selected {
          background: var(--accent);
          color: white;
        }

        .card-mini-preview {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 24px;
          font-size: 10px;
        }

        .mini-cost {
          font-weight: bold;
          font-size: 12px;
        }

        .mini-type {
          font-size: 10px;
        }

        .card-item .card-name {
          flex: 1;
          font-size: 13px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .card-item .delete-btn {
          background: transparent;
          color: inherit;
          opacity: 0.5;
          padding: 2px 6px;
          font-size: 16px;
          min-width: auto;
        }

        .card-item .delete-btn:hover {
          opacity: 1;
          color: var(--accent);
        }

        /* 属性编辑 */
        .card-properties {
          flex: 1;
          padding: 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* 卡牌预览 */
        .card-preview {
          background: linear-gradient(135deg, #2a2a4a 0%, #1a1a2e 100%);
          border: 2px solid var(--type-color, #888);
          border-radius: 8px;
          padding: 16px;
          position: relative;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .preview-name {
          font-size: 16px;
          font-weight: bold;
          color: white;
        }

        .preview-cost {
          background: var(--type-color, #888);
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
        }

        .preview-type {
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-bottom: 4px;
        }

        .preview-rarity {
          font-size: 11px;
          color: #888;
          margin-bottom: 12px;
        }

        .preview-description {
          font-size: 13px;
          color: #ddd;
          line-height: 1.5;
          min-height: 40px;
        }

        .preview-keywords {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 12px;
        }

        .keyword-tag {
          background: rgba(255,255,255,0.1);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          color: #aaa;
        }

        /* 表单 */
        .form-section {
          background: var(--bg-primary);
          border-radius: 8px;
          padding: 16px;
        }

        .form-section h3 {
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 12px;
          color: var(--text-secondary);
        }

        .form-row {
          margin-bottom: 12px;
        }

        .form-row:last-child {
          margin-bottom: 0;
        }

        .form-row-inline {
          display: flex;
          gap: 12px;
        }

        .form-row.half {
          flex: 1;
        }

        .form-row label {
          display: block;
          font-size: 12px;
          font-weight: 500;
          margin-bottom: 6px;
          color: var(--text-secondary);
        }

        .form-row input,
        .form-row select,
        .form-row textarea {
          width: 100%;
        }

        .form-row textarea {
          resize: vertical;
          min-height: 60px;
        }

        .no-selection {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--text-secondary);
          font-size: 14px;
        }

        .empty-card-icon {
          font-size: 48px;
          margin-bottom: 12px;
          opacity: 0.5;
        }

        /* 错误提示 */
        .error-box {
          background: rgba(233, 69, 96, 0.1);
          border: 1px solid var(--accent);
          border-radius: 4px;
          padding: 12px;
        }

        .error-item {
          color: var(--accent);
          font-size: 13px;
          margin-bottom: 4px;
        }

        .error-item:last-child {
          margin-bottom: 0;
        }

        /* 操作按钮 */
        .form-actions {
          display: flex;
          gap: 12px;
        }

        .preview-btn {
          flex: 1;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .save-btn {
          flex: 2;
        }

        /* 代码预览 */
        .code-preview {
          border-top: 1px solid var(--border);
          max-height: 300px;
          display: flex;
          flex-direction: column;
        }

        .code-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          background: var(--bg-tertiary);
          font-size: 13px;
          font-weight: 500;
        }

        .code-header button {
          padding: 4px 8px;
          font-size: 12px;
          background: transparent;
        }

        .code-preview pre {
          flex: 1;
          margin: 0;
          padding: 12px 16px;
          overflow: auto;
          background: var(--bg-primary);
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 12px;
          line-height: 1.5;
        }

        .code-preview code {
          color: var(--text-primary);
        }
      `}</style>
    </div>
  )
}
