import { useState, useEffect } from 'react'
import * as FileService from '../services/FileService'
import { LLM_PROVIDERS, type LLMProvider } from '../services/llm/adapters'
import { useAIStore } from '../stores/useAIStore'
import { Modal } from './Modal'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  gamePath: string
  onGamePathChange: (path: string) => void
}

export function SettingsModal({ isOpen, onClose, gamePath, onGamePathChange }: SettingsModalProps) {
  const provider = useAIStore(state => state.provider)
  const apiKey = useAIStore(state => state.apiKey)
  const setProvider = useAIStore(state => state.setProvider)
  const setApiKey = useAIStore(state => state.setApiKey)
  const [localPath, setLocalPath] = useState(gamePath)
  const [localProvider, setLocalProvider] = useState<LLMProvider>(provider)
  const [localApiKey, setLocalApiKey] = useState(apiKey)

  useEffect(() => {
    setLocalPath(gamePath)
    setLocalProvider(provider)
    setLocalApiKey(apiKey)
  }, [apiKey, gamePath, isOpen, provider])

  const handleBrowse = async () => {
    const path = await FileService.openProjectDirectory()
    if (path) {
      setLocalPath(path)
    }
  }

  const handleSave = () => {
    onGamePathChange(localPath)
    setProvider(localProvider)
    setApiKey(localApiKey)
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

        <div className="setting-group" aria-labelledby="ai-settings-heading">
          <h3 id="ai-settings-heading">项目 AI 对话</h3>
          <p className="setting-desc">
            供应商和密钥只用于右侧项目对话抽屉，不会写入项目文档。
          </p>
          <div className="setting-field">
            <label htmlFor="ai-provider">模型供应商</label>
            <select
              id="ai-provider"
              value={localProvider}
              onChange={(event) => setLocalProvider(event.target.value as LLMProvider)}
            >
              {LLM_PROVIDERS.map(item => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div className="setting-field">
            <label htmlFor="ai-api-key">API Key</label>
            <input
              id="ai-api-key"
              type="password"
              value={localApiKey}
              onChange={(event) => setLocalApiKey(event.target.value)}
              placeholder="输入供应商 API Key"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="setting-hint">留空并保存会停用 AI 对话。</span>
          </div>
        </div>

        <div className="setting-group">
          <h3>关于</h3>
          <p className="about-text">
            Slay the Spire 2 Mod Studio v0.10<br />
            面向项目级 Card 编辑与多轮 AI 协作的 Mod 开发工具。
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

        .path-input input,
        .path-input button,
        .setting-field input,
        .setting-field select {
          min-height: 44px;
        }

        .setting-field {
          display: grid;
          gap: 7px;
          margin-top: 12px;
        }

        .setting-field label {
          color: var(--text-primary);
          font-size: 13px;
          font-weight: 500;
        }

        .setting-field input,
        .setting-field select {
          width: 100%;
          box-sizing: border-box;
          color: var(--text-primary);
          background: var(--bg-primary);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 10px 12px;
        }

        .setting-field input:focus-visible,
        .setting-field select:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .setting-hint {
          color: var(--text-secondary);
          font-size: 12px;
          line-height: 1.5;
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

        .cancel-btn,
        .save-btn {
          min-height: 44px;
          min-width: 72px;
        }
      `}</style>
    </Modal>
  )
}
