import { useState } from 'react'
import { useProjectStore } from './hooks/useProject'
import { useTaskStore } from './stores/useTaskStore'
import { NewProjectModal } from './components/NewProjectModal'
import { CardEditor } from './components/CardEditor'
import { TaskGuide } from './components/TaskGuide'
import { Tutorial } from './components/Tutorial'
import { SettingsModal } from './components/SettingsModal'
import { GameLauncher } from './components/GameLauncher'
import { AIGenerator } from './components/AIGenerator'
import { ThemeToggle } from './components/ThemeToggle'
import { AboutModal } from './components/AboutModal'
import { RelicEditor } from './relic/RelicEditor'

type Tab = 'cards' | 'relics' | 'files' | 'test' | 'ai'

function App() {
  const { projectPath, modManifest, openProject } = useProjectStore()
  const { isTaskMode, showTaskGuide } = useTaskStore()

  const [showNewProject, setShowNewProject] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('cards')
  const [showTutorial, setShowTutorial] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [gamePath, setGamePath] = useState<string>('')

  // 导航到子目录
  const navigateToDir = (dirPath: string) => {
    useProjectStore.getState().setProjectPath(dirPath)
  }

  // 项目创建完成后的回调
  const handleProjectCreated = (path: string) => {
    useProjectStore.getState().setProjectPath(path)
  }

  // 教程完成
  const handleTutorialComplete = () => {
    setShowTutorial(false)
  }

  return (
    <div className="app">
      {/* 顶部栏 */}
      <header className="header">
        <h1>🎮 Mod Studio</h1>
        <div className="header-actions">
          <ThemeToggle />
          <button className="info-btn" onClick={() => setShowAbout(true)} title="关于">
            ℹ️
          </button>
          <button className="settings-btn" onClick={() => setShowSettings(true)} title="设置">
            ⚙️
          </button>
          <button className="secondary-btn" onClick={() => setShowNewProject(true)}>
            📁 新建项目
          </button>
          <button onClick={openProject}>
            📂 打开项目
          </button>
        </div>
      </header>

      {/* 标签栏 */}
      <nav className="tabs">
        <button
          className={activeTab === 'cards' ? 'active' : ''}
          onClick={() => setActiveTab('cards')}
        >
          🃏 卡牌编辑器
        </button>
        <button
          className={activeTab === 'relics' ? 'active' : ''}
          onClick={() => setActiveTab('relics')}
        >
          📜 遗物编辑器
        </button>
        <button
          className={activeTab === 'ai' ? 'active' : ''}
          onClick={() => setActiveTab('ai')}
        >
          ✨ AI生成
        </button>
        <button
          className={activeTab === 'test' ? 'active' : ''}
          onClick={() => setActiveTab('test')}
        >
          🎮 游戏测试
        </button>
        <button
          className={activeTab === 'files' ? 'active' : ''}
          onClick={() => setActiveTab('files')}
        >
          📁 文件浏览
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="main">
        {/* 卡牌编辑器 */}
        {/*
         * CardEditor 只保留一个实例，并在切换标签时保持挂载。
         * AI 提案和其它跨标签编辑会更新同一份 CardDocument；如果这里卸载
         * 编辑器，其自动保存 effect 也会被卸载，切回 Card 时会从磁盘读回旧稿。
         */}
        <div
          className="editor-area"
          style={{ display: activeTab === 'cards' ? undefined : 'none' }}
          aria-hidden={activeTab !== 'cards'}
        >
          {projectPath ? (
            <CardEditor projectPath={projectPath} />
          ) : (
            <div className="no-project">
              <h2>请先打开或创建项目</h2>
              <p>使用顶部的「新建项目」或「打开项目」按钮开始</p>
              <div className="quick-actions">
                <button className="secondary-btn" onClick={() => setShowNewProject(true)}>
                  📁 新建项目
                </button>
                <button onClick={openProject}>
                  📂 打开项目
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 遗物编辑器（节点编辑器 v0.4 端到端） */}
        {activeTab === 'relics' && (
          <div className="editor-area">
            <RelicEditor />
          </div>
        )}

        {/* AI生成 */}
        {activeTab === 'ai' && (
          <div className="ai-area">
            <AIGenerator />
            <div className="ai-tips">
              <h4>💡 使用提示</h4>
              <ul>
                <li>描述越具体，生成的卡牌越符合你的需求</li>
                <li>可以指定卡牌类型、效果、数值等</li>
                <li>例如：「造成10点伤害的火系攻击牌」或「回复5点生命值的技能牌」</li>
                <li>生成后点击卡牌可以添加到编辑器进一步修改</li>
              </ul>
            </div>
          </div>
        )}

        {/* 游戏测试 */}
        {activeTab === 'test' && (
          <div className="test-area">
            <GameLauncher
              gamePath={gamePath}
              projectPath={projectPath}
              onOpenSettings={() => setShowSettings(true)}
            />

            {projectPath && (
              <div className="project-summary">
                <h3>📦 当前项目</h3>
                <div className="summary-item">
                  <span className="label">名称:</span>
                  <span className="value">{modManifest?.name || '未知'}</span>
                </div>
                <div className="summary-item">
                  <span className="label">ID:</span>
                  <span className="value">{modManifest?.id || '未知'}</span>
                </div>
                <div className="summary-item">
                  <span className="label">版本:</span>
                  <span className="value">{modManifest?.version || '1.0.0'}</span>
                </div>
                <button
                  className="show-folder-btn"
                  onClick={() => useProjectStore.getState().showInFolder()}
                >
                  📂 在文件夹中显示
                </button>
              </div>
            )}
          </div>
        )}

        {/* 文件浏览器 */}
        {activeTab === 'files' && (
          <FileBrowser projectPath={projectPath} onNavigate={navigateToDir} />
        )}
      </main>

      {/* 任务引导 */}
      {showTaskGuide && isTaskMode && <TaskGuide />}

      {/* 新手教程 */}
      {showTutorial && <Tutorial onComplete={handleTutorialComplete} />}

      {/* 新建项目弹窗 */}
      <NewProjectModal
        isOpen={showNewProject}
        onClose={() => setShowNewProject(false)}
        onProjectCreated={handleProjectCreated}
      />

      {/* 设置弹窗 */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        gamePath={gamePath}
        onGamePathChange={setGamePath}
      />

      {/* 关于弹窗 */}
      <AboutModal
        isOpen={showAbout}
        onClose={() => setShowAbout(false)}
      />

      <style>{`
        .app {
          display: flex;
          flex-direction: column;
          height: 100vh;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
        }

        .header h1 {
          font-size: 18px;
          font-weight: 600;
        }

        .header-actions {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .theme-toggle, .info-btn, .settings-btn {
          background: transparent;
          padding: 8px 12px;
          font-size: 18px;
        }

        .secondary-btn {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .tabs {
          display: flex;
          gap: 0;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
          padding: 0 12px;
        }

        .tabs button {
          background: transparent;
          color: var(--text-secondary);
          padding: 12px 20px;
          border-radius: 0;
          border-bottom: 2px solid transparent;
          transition: all 0.15s;
        }

        .tabs button:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }

        .tabs button.active {
          color: var(--accent);
          border-bottom-color: var(--accent);
        }

        .main {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .editor-area, .test-area {
          flex: 1;
          display: flex;
          overflow: hidden;
        }

        .test-area {
          flex-direction: column;
          padding: 16px;
          gap: 16px;
        }

        .no-project {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 40px;
        }

        .no-project h2 {
          font-size: 20px;
          margin-bottom: 12px;
        }

        .no-project p {
          color: var(--text-secondary);
          margin-bottom: 24px;
        }

        .quick-actions {
          display: flex;
          gap: 12px;
        }

        .project-summary {
          background: var(--bg-secondary);
          border-radius: 8px;
          padding: 16px;
          margin-top: 16px;
        }

        .project-summary h3 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px 0;
        }

        .summary-item {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 13px;
        }

        .summary-item .label {
          color: var(--text-secondary);
        }

        .summary-item .value {
          color: var(--text-primary);
        }

        .show-folder-btn {
          width: 100%;
          margin-top: 12px;
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .ai-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          padding: 16px;
          gap: 16px;
          overflow-y: auto;
        }

        .ai-tips {
          background: var(--bg-secondary);
          border-radius: 8px;
          padding: 16px;
        }

        .ai-tips h4 {
          font-size: 14px;
          font-weight: 600;
          margin: 0 0 12px 0;
        }

        .ai-tips ul {
          margin: 0;
          padding-left: 20px;
          font-size: 13px;
          color: var(--text-secondary);
          line-height: 1.8;
        }
      `}</style>
    </div>
  )
}

// 文件浏览器组件
function FileBrowser({ projectPath, onNavigate }: { projectPath: string | null; onNavigate: (path: string) => void }) {
  const { files, selectedFile, fileContent, loading, loadFile, clearSelection, navigateUp } = useProjectStore()

  if (!projectPath) {
    return (
      <div className="empty-state">
        <p>暂无打开的项目</p>
      </div>
    )
  }

  return (
    <>
      <aside className="sidebar">
        <div className="path-bar">
          <button onClick={navigateUp}>⬆️</button>
          <span className="current-path">{projectPath.split(/[/\\]/).pop()}</span>
        </div>

        <div className="file-list">
          {loading ? (
            <div className="loading">加载中...</div>
          ) : files.length === 0 ? (
            <div className="empty">空文件夹</div>
          ) : (
            files.map((file) => (
              <div
                key={file.path}
                className={`file-item ${file.isDirectory ? 'folder' : 'file'} ${selectedFile === file.path ? 'selected' : ''}`}
                onClick={() => file.isDirectory ? onNavigate(file.path) : loadFile(file.path)}
              >
                <span className="icon">{file.isDirectory ? '📁' : '📄'}</span>
                <span className="name">{file.name}</span>
              </div>
            ))
          )}
        </div>
      </aside>

      <section className="content">
        {selectedFile && fileContent !== null ? (
          <div className="file-content">
            <div className="content-header">
              <span>{selectedFile.split(/[/\\]/).pop()}</span>
              <button className="close-btn" onClick={clearSelection}>×</button>
            </div>
            <pre className="code-preview">
              <code>{fileContent}</code>
            </pre>
          </div>
        ) : (
          <div className="welcome">
            <h2>文件浏览器</h2>
            <p>选择一个文件查看内容</p>
          </div>
        )}
      </section>

      <style>{`
        .sidebar {
          width: 280px;
          background: var(--bg-secondary);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .path-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          border-bottom: 1px solid var(--border);
        }

        .path-bar button {
          padding: 4px 8px;
          font-size: 12px;
          min-width: 32px;
        }

        .current-path {
          font-size: 13px;
          color: var(--text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
        }

        .file-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .file-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s;
        }

        .file-item:hover {
          background: var(--bg-tertiary);
        }

        .file-item.selected {
          background: var(--accent);
          color: white;
        }

        .file-item .icon {
          font-size: 16px;
        }

        .file-item .name {
          font-size: 14px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .content {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .file-content {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .content-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-secondary);
          border-bottom: 1px solid var(--border);
          font-size: 14px;
          font-weight: 500;
        }

        .close-btn {
          background: transparent;
          color: var(--text-secondary);
          padding: 4px 8px;
          font-size: 18px;
          line-height: 1;
        }

        .close-btn:hover {
          color: var(--accent);
        }

        .code-preview {
          flex: 1;
          margin: 0;
          padding: 16px;
          overflow: auto;
          background: var(--bg-primary);
          font-family: 'Fira Code', 'Consolas', monospace;
          font-size: 13px;
          line-height: 1.5;
        }

        .code-preview code {
          color: var(--text-primary);
        }

        .welcome {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          text-align: center;
          padding: 40px;
        }

        .welcome h2 {
          font-size: 24px;
          margin-bottom: 16px;
        }

        .welcome > p {
          color: var(--text-secondary);
        }

        .empty, .loading, .empty-state {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          width: 100%;
          color: var(--text-secondary);
          font-size: 14px;
        }
      `}</style>
    </>
  )
}

export default App
