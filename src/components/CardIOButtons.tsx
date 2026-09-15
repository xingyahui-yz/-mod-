/**
 * 卡牌导入导出按钮
 */
import { useRef } from 'react'
import { cardCatalogActions, getCardCatalogView, useCardCatalog } from '../card/cardCatalog'
import { exportCards, importCards, generateExportFilename } from '../utils/cardIO'
import { useTransientMessage } from '../hooks/useTransientMessage'
import { Toast } from './Toast'
import { createEmptyGraph } from '../node-editor/graph'
import { CURRENT_CARD_SCHEMA_VERSION, type CardDocument } from '../card/cardDocument'
import * as FileService from '../services/FileService'
import { reserveCardId } from '../card/cardIdReservation'

export function CardIOButtons({
  projectPath,
  onDocumentPersisted,
}: {
  projectPath: string | null
  onDocumentPersisted: (document: CardDocument) => void
}) {
  const cards = useCardCatalog(view => view.cards)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { message, showMessage } = useTransientMessage()

  const handleExport = () => {
    if (cards.length === 0) {
      showMessage('error', '没有卡牌可以导出')
      return
    }

    const json = exportCards([...cards])
    const filename = generateExportFilename()

    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    showMessage('success', `已导出 ${cards.length} 张卡牌到 ${filename}`)
  }

  const handleImport = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const result = importCards(text)

      if (result.success && result.cards.length > 0) {
        let imported = 0
        const failures: string[] = []
        for (const card of result.cards) {
          if (!projectPath) {
            failures.push(`${card.id}：请先打开项目`)
            continue
          }
          const reservation = reserveCardId(projectPath, card.id)
          if (!reservation) {
            failures.push(`${card.id}：ID 正在被其他创建操作占用`)
            continue
          }
          try {
            const catalog = getCardCatalogView()
            if (catalog.cards.some(existing => existing.id.toLowerCase() === card.id.toLowerCase())) {
              failures.push(`${card.id}：ID 已存在`)
              continue
            }
            const document: CardDocument = {
              schemaVersion: CURRENT_CARD_SCHEMA_VERSION,
              card,
              graph: createEmptyGraph(card.id, 'card'),
              generation: { lastGeneratedFingerprint: null },
            }
            const saved = await FileService.createCardDocument(projectPath, document)
            if (!saved.ok) {
              failures.push(`${card.id}：${saved.error}`)
              continue
            }
            if (getCardCatalogView().sourceProjectRoot !== projectPath) {
              failures.push(`${card.id}：项目已切换，请重新加载目标项目`)
              continue
            }
            const created = cardCatalogActions.createCardDocument(document)
            if (!created.ok) {
              failures.push(`${card.id}：目录已变化，请重新加载项目`)
              continue
            }
            onDocumentPersisted(document)
            imported += 1
          } finally {
            reservation.release()
          }
        }
        if (failures.length > 0) {
          showMessage('error', `已导入 ${imported} 张；${failures.join('；')}`)
        } else {
          showMessage('success', `已导入 ${imported} 张卡牌`)
        }
      } else {
        showMessage('error', result.error || '导入失败')
      }
    } catch (err) {
      showMessage('error', `读取文件失败: ${err}`)
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <div className="card-io-buttons">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <div className="io-actions">
        <button className="io-btn" onClick={handleExport} title="导出所有卡牌">
          📥 导出
        </button>
        <button className="io-btn" onClick={handleImport} title="从JSON文件导入卡牌" disabled={!projectPath}>
          📤 导入
        </button>
      </div>

      <Toast message={message} className="io-message" />

      <style>{`
        .card-io-buttons {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .io-actions {
          display: flex;
          gap: 6px;
        }

        .io-btn {
          padding: 6px 12px;
          font-size: 12px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .io-message {
          font-size: 12px;
        }
      `}</style>
    </div>
  )
}
