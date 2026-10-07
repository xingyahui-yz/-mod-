import { useEffect, useState } from 'react'
import { getTheme, setTheme as saveTheme, toggleTheme } from '../utils/theme'

export function ThemeToggle() {
  const [theme, setLocalTheme] = useState<'dark' | 'light'>(getTheme())

  // 同步到DOM（用于SSR/初始应用）
  useEffect(() => {
    saveTheme(theme)
  }, [theme])

  const handleToggle = () => {
    setLocalTheme(toggleTheme())
  }

  return (
    <button
      className="theme-toggle"
      onClick={handleToggle}
      title={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
      aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}