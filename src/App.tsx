import { useState } from 'react'
import { useProjectStore } from './hooks/useProject'
import { useTaskStore } from './stores/useTaskStore'
import { NewProjectModal } from './components/NewProjectModal'
import { CardEditor } from './components/CardEditor'
import { TaskGuide } from './components/TaskGuide'
import { Tutorial } from './components/Tutorial'
import { SettingsModal } from './components/SettingsModal'
import { GameLauncher } from './components/GameLauncher'
import { ThemeToggle } from './components/ThemeToggle'
import { AboutModal } from './components/AboutModal'
import { RelicEditor } from './relic/RelicEditor'
import { ProjectConversationProvider, usePrepareForProjectSwitch } from './ai-conversation/ProjectConversationContext'
import { ProjectConversationDrawer } from './ai-conversation/ProjectConversationDrawer'
import { ModManager } from './mod-manager/ModManager'
import { cardCatalogActions } from './card/cardCatalog'
import * as FileService from './services/FileService'

type Tab = 'cards' | 'relics' | 'mods' | 'files' | 'test'

const tabLabels: Record<Tab, string> = {
  cards: '卡牌编辑器',
  relics: '遗物编辑器',
  mods: 'Mod 管理器',
  files: '文件浏览',
  test: '游戏测试',
}

function App() {
  const projectRoot = useProjectStore(state => state.projectRoot)
  return (
    <ProjectConversationProvider projectRoot={projectRoot}>
      <AppContent />
    </ProjectConversationProvider>
  )
}

function AppContent() {
  const { projectRoot, browsePath, modManifest, setProjectRoot, loadDirectory } = useProjectStore()
  const { isTaskMode, showTaskGuide } = useTaskStore()
  const prepareForProjectSwitch = usePrepareForProjectSwitch()

  const [showNewProject, setShowNewProject] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('cards')
  const [showTutorial, setShowTutorial] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [gamePath, setGamePath] = useState<string>('')

  // 导航到子目录
  const navigateToDir = (dirPath: string) => {
    void loadDirectory(dirPath)
  }

  // 项目创建完成后的回调
  const handleProjectCreated = async (path: string) => {
    if (path === projectRoot || await prepareForProjectSwitch()) {
      await setProjectRoot(path)
    }
  }

  const handleOpenProject = async () => {
    const path = await FileService.openProjectDirectory()
    if (!path || path === projectRoot) return
    if (await prepareForProjectSwitch()) await setProjectRoot(path)
  }

  // 教程完成
  const handleTutorialComplete = () => {
    setShowTutorial(false)
  }

  const handleOpenCardFromConversation = (cardId: string) => {
    if (!cardCatalogActions.selectCard(cardId).ok) return
    setActiveTab('cards')
  }

  const projectName = modManifest?.name || projectRoot?.split(/[/\\]/).filter(Boolean).pop() || null

  return (
    <div className="app">
      <header className="header">
        <div className="brand-lockup">
          <span className="brand-seal" aria-hidden="true">MS</span>
          <div className="brand-copy">
            <span className="brand-eyebrow">SLAY THE SPIRE 2 · CREATOR STUDIO</span>
            <h1>Mod Studio</h1>
          </div>
        </div>
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
          <button onClick={() => void handleOpenProject()}>
            📂 打开项目
          </button>
        </div>
      </header>

      <div className="app-frame">
        <aside className="app-sidebar" aria-label="工作区导航">
          <div className="sidebar-project">
            <span className="project-avatar" aria-hidden="true">{projectName?.slice(0, 1) || 'S'}</span>
            <span className="sidebar-project-copy">
              <strong>{projectName || '未打开项目'}</strong>
              <span>{projectRoot ? '当前工作项目' : 'Slay the Spire 2'}</span>
            </span>
            <span className={`project-light ${projectRoot ? 'is-ready' : ''}`} aria-hidden="true" />
          </div>

          <nav className="side-nav" aria-label="创作工具">
            <p className="nav-section-label">创作工具</p>
            <button
              className={activeTab === 'cards' ? 'active' : ''}
              aria-current={activeTab === 'cards' ? 'page' : undefined}
              onClick={() => setActiveTab('cards')}
            >
              <span className="nav-icon" aria-hidden="true">🃏</span><span>卡牌编辑器</span>
            </button>
            <button
              className={activeTab === 'relics' ? 'active' : ''}
              aria-current={activeTab === 'relics' ? 'page' : undefined}
              onClick={() => setActiveTab('relics')}
            >
              <span className="nav-icon" aria-hidden="true">📜</span><span>遗物编辑器</span>
            </button>

            <p className="nav-section-label nav-section-spaced">项目工具</p>
            <button
              className={activeTab === 'mods' ? 'active' : ''}
              aria-current={activeTab === 'mods' ? 'page' : undefined}
              onClick={() => setActiveTab('mods')}
            >
              <span className="nav-icon" aria-hidden="true">🧩</span><span>Mod 管理器</span>
            </button>
            <button
              className={activeTab === 'files' ? 'active' : ''}
              aria-current={activeTab === 'files' ? 'page' : undefined}
              onClick={() => setActiveTab('files')}
            >
              <span className="nav-icon" aria-hidden="true">📁</span><span>文件浏览</span>
            </button>
            <button
              className={activeTab === 'test' ? 'active' : ''}
              aria-current={activeTab === 'test' ? 'page' : undefined}
              onClick={() => setActiveTab('test')}
            >
              <span className="nav-icon" aria-hidden="true">🎮</span><span>游戏测试</span>
            </button>
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-footer-prompt">
              <span className="sidebar-footer-mark" aria-hidden="true">✦</span>
              <div><strong>创作从这里开始</strong><span>打开项目后解锁完整工作区</span></div>
            </div>
            <button className="sidebar-settings-entry" onClick={() => setShowSettings(true)}>
              <span aria-hidden="true">⚙</span> 设置与 API Key
            </button>
          </div>
        </aside>

        <section className="content-column">
          <div className="workspace-heading">
            <div>
              <p className="workspace-kicker">MOD STUDIO <span>/</span> {projectName || 'WORKSPACE'}</p>
              <h2>{tabLabels[activeTab]}</h2>
            </div>
            <div className={`project-status ${projectRoot ? 'is-ready' : ''}`}>
              <span className="project-light" aria-hidden="true" />
              {projectName || '还没有打开项目'}
            </div>
          </div>

          <div className="workspace-shell">
            <main className="main">
              {/* Keep one editor mounted so AI proposals and autosave share one document. */}
              <div
                className="editor-area"
                style={{ display: activeTab === 'cards' ? undefined : 'none' }}
                aria-hidden={activeTab !== 'cards'}
              >
                {projectRoot ? (
                  <CardEditor projectPath={projectRoot} />
                ) : (
                  <div className="no-project">
                    <div className="welcome-hero">
                      <span className="welcome-kicker">SLAY THE SPIRE 2 · MOD CREATION</span>
                      <h2>把你的想法，做成一张新卡牌</h2>
                      <p>从一个 Mod 项目开始，设计卡牌与遗物，再在游戏中亲自试玩。</p>
                      <div className="quick-actions">
                        <button className="secondary-btn" onClick={() => setShowNewProject(true)}>
                          <span aria-hidden="true">＋</span> 新建项目
                        </button>
                        <button onClick={() => void handleOpenProject()}>
                          <span aria-hidden="true">↗</span> 打开项目
                        </button>
                      </div>
                    </div>
                    <div className="welcome-features" aria-label="Mod Studio 功能">
                      <div className="welcome-feature-card">
                        <span className="feature-icon feature-cards" aria-hidden="true">🃏</span>
                        <div><strong>卡牌创作</strong><span>编辑属性、描述与效果</span></div>
                        <span className="feature-arrow" aria-hidden="true">›</span>
                      </div>
                      <div className="welcome-feature-card">
                        <span className="feature-icon feature-relics" aria-hidden="true">📜</span>
                        <div><strong>遗物设计</strong><span>构建专属遗物与触发逻辑</span></div>
                        <span className="feature-arrow" aria-hidden="true">›</span>
                      </div>
                      <div className="welcome-feature-card">
                        <span className="feature-icon feature-ai" aria-hidden="true">✦</span>
                        <div><strong>AI 创作助手</strong><span>在工作区边聊边完善提案</span></div>
                        <span className="feature-arrow" aria-hidden="true">›</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {activeTab === 'relics' && (
                <div className="editor-area"><RelicEditor /></div>
              )}

              {activeTab === 'mods' && (
                <ModManager gamePath={gamePath} onOpenSettings={() => setShowSettings(true)} />
              )}

              {activeTab === 'test' && (
                <div className="test-area">
                  <GameLauncher
                    gamePath={gamePath}
                    projectPath={projectRoot}
                    onOpenSettings={() => setShowSettings(true)}
                  />

                  {projectRoot && (
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

              {activeTab === 'files' && (
                <FileBrowser browsePath={browsePath} onNavigate={navigateToDir} />
              )}
            </main>
            <ProjectConversationDrawer onOpenCard={handleOpenCardFromConversation} />
          </div>
        </section>
      </div>

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

    </div>
  )
}

// 文件浏览器组件
function FileBrowser({ browsePath, onNavigate }: { browsePath: string | null; onNavigate: (path: string) => void }) {
  const { files, selectedFile, fileContent, loading, loadFile, clearSelection, navigateUp } = useProjectStore()

  if (!browsePath) {
    return (
      <div className="empty-state">
        <p>暂无打开的项目</p>
      </div>
    )
  }

  return (
    <>
      <aside className="file-sidebar">
        <div className="path-bar">
          <button onClick={navigateUp}>⬆️</button>
          <span className="current-path">{browsePath.split(/[/\\]/).pop()}</span>
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


    </>
  )
}

export default App
