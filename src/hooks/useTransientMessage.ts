/**
 * 临时消息Hook
 * 用于显示自动消失的toast消息
 */
import { useState, useRef, useCallback } from 'react'

export type MessageType = 'success' | 'error' | 'info'

export interface TransientMessage {
  type: MessageType
  text: string
}

export function useTransientMessage(duration = 3000) {
  const [message, setMessage] = useState<TransientMessage | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showMessage = useCallback((type: MessageType, text: string) => {
    setMessage({ type, text })

    // 清除旧timer
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      setMessage(null)
      timerRef.current = null
    }, duration)
  }, [duration])

  const clearMessage = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setMessage(null)
  }, [])

  return { message, showMessage, clearMessage }
}