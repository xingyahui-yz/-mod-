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
          border: 1px solid color-mix(in srgb, var(--success) 32%, var(--border));
          background: color-mix(in srgb, var(--success) 9%, var(--bg-secondary));
          color: var(--success);
        }

        .toast.error {
          border: 1px solid color-mix(in srgb, var(--danger) 32%, var(--border));
          background: var(--danger-soft);
          color: var(--danger);
        }

        .toast.info {
          border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
          background: var(--accent-soft);
          color: var(--accent);
        }
      `}</style>
    </div>
  )
}
