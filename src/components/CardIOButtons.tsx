/**
 * 卡牌导入导出按钮
 */
import { useRef } from 'react'
import { useCardStore } from '../stores/useCardStore'
import { exportCards, importCards, generateExportFilename } from '../utils/cardIO'
import { useTransientMessage } from '../hooks/useTransientMessage'
import { Toast } from './Toast'

export function CardIOButtons() {
  const { cards, addCardWithData } = useCardStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { message, showMessage } = useTransientMessage()

  const handleExport = () => {
    if (cards.length === 0) {
      showMessage('error', '没有卡牌可以导出')
      return
    }

    const json = exportCards(cards)
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
        result.cards.forEach(card => addCardWithData(card))
        showMessage('success', `已导入 ${result.cards.length} 张卡牌`)
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
        <button className="io-btn" onClick={handleImport} title="从JSON文件导入卡牌">
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