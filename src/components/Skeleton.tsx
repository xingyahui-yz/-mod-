/**
 * 骨架屏组件 - 加载占位
 */
interface SkeletonProps {
  width?: string | number
  height?: string | number
  count?: number
  circle?: boolean
}

export function Skeleton({ width = '100%', height = 16, count = 1, circle = false }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i)

  return (
    <>
      {items.map(i => (
        <div
          key={i}
          className={`skeleton ${circle ? 'circle' : ''}`}
          style={{
            width: typeof width === 'number' ? `${width}px` : width,
            height: typeof height === 'number' ? `${height}px` : height,
            marginBottom: count > 1 && i < count - 1 ? '8px' : 0
          }}
        />
      ))}

      <style>{`
        .skeleton {
          background: linear-gradient(
            90deg,
            var(--bg-tertiary) 25%,
            var(--border) 50%,
            var(--bg-tertiary) 75%
          );
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
          border-radius: 4px;
        }

        .skeleton.circle {
          border-radius: 50%;
        }

        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </>
  )
}

export function CardListSkeleton() {
  return (
    <div className="card-list-skeleton">
      {[1, 2, 3].map(i => (
        <div key={i} className="skeleton-card-item">
          <Skeleton width={24} height={24} circle />
          <Skeleton width="70%" height={14} />
        </div>
      ))}

      <style>{`
        .card-list-skeleton {
          padding: 8px;
        }

        .skeleton-card-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px;
          margin-bottom: 4px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  )
}