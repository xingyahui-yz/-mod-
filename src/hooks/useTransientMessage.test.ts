/**
 * useTransientMessage 测试
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTransientMessage } from './useTransientMessage'

describe('useTransientMessage', () => {
  it('初始message应为null', () => {
    const { result } = renderHook(() => useTransientMessage())
    expect(result.current.message).toBeNull()
  })

  it('showMessage应设置message', () => {
    const { result } = renderHook(() => useTransientMessage())

    act(() => {
      result.current.showMessage('success', '测试消息')
    })

    expect(result.current.message).toEqual({
      type: 'success',
      text: '测试消息'
    })
  })

  it('应支持不同消息类型', () => {
    const { result } = renderHook(() => useTransientMessage())

    act(() => {
      result.current.showMessage('error', '错误消息')
    })

    expect(result.current.message?.type).toBe('error')
  })

  it('clearMessage应立即清除消息', () => {
    const { result } = renderHook(() => useTransientMessage())

    act(() => {
      result.current.showMessage('info', '信息')
    })

    expect(result.current.message).not.toBeNull()

    act(() => {
      result.current.clearMessage()
    })

    expect(result.current.message).toBeNull()
  })

  it('应在duration后自动清除', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTransientMessage(1000))

    act(() => {
      result.current.showMessage('success', '测试')
    })

    expect(result.current.message).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(result.current.message).toBeNull()
    vi.useRealTimers()
  })

  it('后续showMessage应重置timer', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTransientMessage(1000))

    act(() => {
      result.current.showMessage('success', '第一')
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    act(() => {
      result.current.showMessage('success', '第二')
    })

    act(() => {
      vi.advanceTimersByTime(500)
    })

    // 还没到第二消息的清除时间
    expect(result.current.message?.text).toBe('第二')

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(result.current.message).toBeNull()
    vi.useRealTimers()
  })
})