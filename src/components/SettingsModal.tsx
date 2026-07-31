import { useState, useEffect } from 'react'
import * as FileService from '../services/FileService'
import { Modal } from './Modal'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  gamePath: string
  onGamePathChange: (path: string) => void
}

export function SettingsModal({ isOpen, onClose, gamePath, onGamePathChange }: SettingsModalProps) {
  const [localPath, setLocalPath] = useState(gamePath)

  useEffect(() => {
    setLocalPath(gamePath)
  }, [gamePath])

  const handleBrowse = async () => {
    const path = await FileService.openProjectDirectory()
    if (path) {
      setLocalPath(path)
    }
  }

  const handleSave = () => {
    onGamePathChange(localPath)
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="⚙️ 设置" width={500}>
      <div className="settings-body">
        <div className="setting-group">
          <h3>游戏路径</h3>
          <p className="setting-desc">
            设置杀戮尖塔2的安装路径，用于启动游戏测试你的Mod。
          </p>
          <div className="path-input">
            <input
              type="text"
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="例如: C:\Program Files\Steam\steamapps\common\Slay the Spire 2"
            />
            <button onClick={handleBrowse}>浏览</button>
          </div>
        </div>

        <div className="setting-group">
          <h3>关于</h3>
          <p className="about-text">
            Slay the Spire 2 Mod Studio v0.1.0<br />
            一个简洁的杀戮尖塔2 Mod开发工具。
          </p>
        </div>
      </div>

      <div className="settings-footer">
        <button className="cancel-btn" onClick={onClose}>取消</button>
        <button className="save-btn" onClick={handleSave}>保存</button>
      </div>

      <style>{`
        .settings-body {
          padding: 20px;
        }

        .setting-group {
          margin-bottom: 24px;
        }

        .setting-group:last-child {
          margin-bottom: 0;
        }

        .setting-group h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 8px 0;
          color: var(--text-primary);
        }

        .setting-desc {
          font-size: 13px;
          color: var(--text-secondary);
          margin: 0 0 12px 0;
          line-height: 1.5;
        }

        .path-input {
          display: flex;
          gap: 8px;
        }

        .path-input input {
          flex: 1;
        }

        .path-input button {
          white-space: nowrap;
        }

        .about-text {
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        .settings-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--border);
        }

        .cancel-btn {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .save-btn {
          background: var(--accent);
        }
      `}</style>
    </Modal>
  )
}