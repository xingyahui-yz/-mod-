/**
 * theme utility 测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getTheme, setTheme, applyTheme, toggleTheme } from './theme'

describe('theme utility', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  describe('getTheme', () => {
    it('默认应返回dark', () => {
      expect(getTheme()).toBe('dark')
    })

    it('应返回localStorage中保存的主题', () => {
      localStorage.setItem('mod-studio-theme', 'light')
      expect(getTheme()).toBe('light')
    })
  })

  describe('setTheme', () => {
    it('应保存主题到localStorage', () => {
      setTheme('light')
      expect(localStorage.getItem('mod-studio-theme')).toBe('light')
    })

    it('应应用主题到document', () => {
      setTheme('light')
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })
  })

  describe('applyTheme', () => {
    it('应设置data-theme属性', () => {
      applyTheme('light')
      expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    })
  })

  describe('toggleTheme', () => {
    it('应从dark切换到light', () => {
      setTheme('dark')
      const result = toggleTheme()
      expect(result).toBe('light')
    })

    it('应从light切换到dark', () => {
      setTheme('light')
      const result = toggleTheme()
      expect(result).toBe('dark')
    })
  })
})