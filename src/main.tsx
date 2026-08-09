import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyTheme, getTheme } from './utils/theme'
import { installFileService } from './services/FileService'
import './index.css'

// 初始化主题
applyTheme(getTheme())

// v0.8-2 factory seam: 在 React 渲染前, 用 prod electronAPI 安装 FileService 单例.
// 之后所有 `import * as FileService` 都路由到这个实例 (window.electronAPI 在 jsdom
// 不存在, 会回落到内置 noOpApi — 产线打包后由 Electron preload 注入).
installFileService({
  api: (typeof window !== 'undefined' && (window as any).electronAPI) || undefined,
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)