import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * 全局错误边界
 * 捕获子组件的错误，显示友好错误提示
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="error-boundary">
          <div className="error-content">
            <div className="error-icon">⚠️</div>
            <h2>出错了</h2>
            <p className="error-message">
              {this.state.error?.message || '发生了未知错误'}
            </p>
            <div className="error-actions">
              <button onClick={this.handleReset}>🔄 重试</button>
              <button className="secondary-btn" onClick={this.handleReload}>
                🔃 刷新页面
              </button>
            </div>
          </div>

          <style>{`
            .error-boundary {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              background: var(--bg-primary);
            }

            .error-content {
              text-align: center;
              padding: 40px;
              max-width: 500px;
            }

            .error-icon {
              font-size: 64px;
              margin-bottom: 20px;
            }

            .error-content h2 {
              font-size: 24px;
              margin-bottom: 16px;
            }

            .error-message {
              color: var(--text-secondary);
              margin-bottom: 24px;
              padding: 12px;
              background: var(--bg-secondary);
              border-radius: 6px;
              font-size: 13px;
              word-break: break-word;
            }

            .error-actions {
              display: flex;
              gap: 12px;
              justify-content: center;
            }

            .secondary-btn {
              background: var(--bg-tertiary);
              color: var(--text-primary);
            }
          `}</style>
        </div>
      )
    }

    return this.props.children
  }
}