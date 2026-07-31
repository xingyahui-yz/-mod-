/**
 * Toast组件 - 统一的消息显示
 */
import { TransientMessage } from '../hooks/useTransientMessage'

interface ToastProps {
  message: TransientMessage | null
  className?: string
}

export function Toast({ message, className = 'toast' }: ToastProps) {
  if (!message) return null

  return (
    <div className={`${className} ${message.type}`}>
      {message.text}

      <style>{`
        .toast {
          padding: 10px 12px;
          border-radius: 6px;
          font-size: 13px;
          margin: 12px 0;
          line-height: 1.5;
        }

        .toast.success {
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
        }

        .toast.error {
          background: rgba(233, 69, 96, 0.1);
          color: var(--accent);
        }

        .toast.info {
          background: rgba(59, 130, 246, 0.1);
          color: #3b82f6;
        }
      `}</style>
    </div>
  )
}