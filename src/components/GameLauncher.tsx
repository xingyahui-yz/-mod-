import { useState } from 'react'
import * as FileService from '../services/FileService'
import { useTransientMessage } from '../hooks/useTransientMessage'
import { Toast } from './Toast'

interface GameLauncherProps {
  gamePath: string | null
  projectPath: string | null
  onOpenSettings?: () => void
}

export function GameLauncher({ gamePath, projectPath, onOpenSettings }: GameLauncherProps) {
  const [launching, setLaunching] = useState(false)
  const { message, showMessage } = useTransientMessage(5000)

  const handleLaunch = async () => {
    if (!gamePath) {
      showMessage('error', '⚠️ 请先在设置中配置游戏路径')
      return
    }

    if (!projectPath) {
      showMessage('error', '⚠️ 请先打开或创建一个Mod项目')
      return
    }

    setLaunching(true)
    showMessage('info', '🔎 正在执行 Card 产物预检...')

    try {
      const preflight = await FileService.preflightCardProject(projectPath)
      if (!preflight.ok) {
        const summary = preflight.blocking
          .map(item => `${item.cardId}: ${item.reason}`)
          .join('；')
        showMessage('error', `❌ 测试预检未通过：${summary}`)
        setLaunching(false)
        return
      }

      showMessage('info', '🔄 正在启动游戏...')
      const result = await FileService.launchGame(gamePath, projectPath)

      if (result.success) {
        showMessage('success', '✅ 游戏已启动！检查游戏内是否加载了你的Mod。')
      } else {
        showMessage('error', `❌ 启动失败: ${result.error}`)
      }
    } catch (err) {
      showMessage('error', `❌ 启动失败: ${err}`)
    }

    setLaunching(false)
  }

  return (
    <div className="game-launcher">
      <div className="launcher-header">
        <h3>🎮 游戏测试</h3>
        {onOpenSettings && (
          <button className="settings-btn" onClick={onOpenSettings}>
            ⚙️
          </button>
        )}
      </div>

      <div className="launcher-content">
        <div className="status-item">
          <span className="status-label">游戏路径:</span>
          <span className={`status-value ${gamePath ? 'ok' : 'missing'}`}>
            {gamePath ? '✅ 已配置' : '❌ 未配置'}
          </span>
        </div>

        <div className="status-item">
          <span className="status-label"> Mod项目:</span>
          <span className={`status-value ${projectPath ? 'ok' : 'missing'}`}>
            {projectPath ? '✅ 已打开' : '❌ 未打开'}
          </span>
        </div>

        <Toast message={message} className="launch-message" />

        <button
          className="launch-btn"
          onClick={handleLaunch}
          disabled={launching || !gamePath || !projectPath}
        >
          {launching ? '🔄 启动中...' : '🚀 启动游戏测试'}
        </button>

        {!gamePath && (
          <p className="help-text">
            💡 点击右上角「⚙️」设置游戏路径
          </p>
        )}
      </div>

      <style>{`
        .game-launcher {
          background: var(--bg-secondary);
          border-radius: 8px;
          overflow: hidden;
        }

        .launcher-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border);
        }

        .launcher-header h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .settings-btn {
          background: transparent;
          padding: 4px 8px;
          font-size: 16px;
        }

        .launcher-content {
          padding: 16px;
        }

        .status-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--border);
        }

        .status-item:last-of-type {
          border-bottom: none;
        }

        .status-label {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .status-value {
          font-size: 13px;
          font-weight: 500;
        }

        .status-value.ok {
          color: #4ade80;
        }

        .status-value.missing {
          color: var(--accent);
        }

        .launch-btn {
          width: 100%;
          padding: 12px;
          font-size: 14px;
          font-weight: 600;
          margin-top: 8px;
        }

        .launch-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .help-text {
          font-size: 12px;
          color: var(--text-secondary);
          text-align: center;
          margin: 12px 0 0 0;
        }
      `}</style>
    </div>
  )
}
