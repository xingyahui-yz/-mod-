import { useTaskStore } from '../stores/useTaskStore'

export function TaskGuide() {
  const {
    tasks,
    currentTaskId,
    showTaskGuide,
    isTaskMode,
    completeTask,
    skipTask,
    toggleTaskGuide,
    getProgress
  } = useTaskStore()

  const progress = getProgress()

  if (!showTaskGuide || !isTaskMode) return null

  return (
    <div className="task-guide">
      <div className="task-header">
        <h3>📋 任务进度</h3>
        <span className="progress-text">
          {progress.completed}/{progress.total}
        </span>
        <button className="close-btn" onClick={toggleTaskGuide}>×</button>
      </div>

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${(progress.completed / progress.total) * 100}%` }}
        />
      </div>

      <div className="task-list">
        {tasks.map((task) => {
          const isActive = task.id === currentTaskId

          return (
            <div
              key={task.id}
              className={`task-item ${task.status} ${isActive ? 'active' : ''}`}
            >
              <div className="task-status-icon">
                {task.status === 'completed' && '✅'}
                {task.status === 'skipped' && '⏭️'}
                {task.status === 'pending' && !isActive && '⭕'}
                {task.status === 'pending' && isActive && '🔄'}
              </div>

              <div className="task-content">
                <div className="task-title">{task.title}</div>
                {isActive && (
                  <div className="task-desc">{task.description}</div>
                )}
              </div>

              {isActive && (
                <div className="task-actions">
                  <button
                    className="complete-btn"
                    onClick={() => completeTask(task.id)}
                    title="完成任务"
                  >
                    ✓
                  </button>
                  <button
                    className="skip-btn"
                    onClick={() => skipTask(task.id)}
                    title="跳过"
                  >
                    →
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {progress.completed === progress.total && (
        <div className="task-complete">
          🎉 恭喜完成所有任务！
        </div>
      )}

      <style>{`
        .task-guide {
          position: fixed;
          right: 16px;
          top: 80px;
          width: 280px;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
          z-index: 100;
          overflow: hidden;
        }

        .task-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-tertiary);
          border-bottom: 1px solid var(--border);
        }

        .task-header h3 {
          flex: 1;
          font-size: 14px;
          font-weight: 600;
          margin: 0;
        }

        .progress-text {
          font-size: 12px;
          color: var(--text-secondary);
          margin-right: 8px;
        }

        .close-btn {
          background: transparent;
          color: var(--text-secondary);
          padding: 0 4px;
          font-size: 18px;
          line-height: 1;
        }

        .close-btn:hover {
          color: var(--accent);
        }

        .progress-bar {
          height: 3px;
          background: var(--bg-tertiary);
        }

        .progress-fill {
          height: 100%;
          background: var(--accent);
          transition: width 0.3s ease;
        }

        .task-list {
          max-height: 400px;
          overflow-y: auto;
          padding: 8px;
        }

        .task-item {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 10px;
          border-radius: 6px;
          transition: background 0.15s;
        }

        .task-item.active {
          background: rgba(233, 69, 96, 0.1);
        }

        .task-item.completed {
          opacity: 0.7;
        }

        .task-item.skipped {
          opacity: 0.5;
        }

        .task-status-icon {
          font-size: 14px;
          margin-top: 2px;
        }

        .task-content {
          flex: 1;
        }

        .task-title {
          font-size: 13px;
          font-weight: 500;
          color: var(--text-primary);
        }

        .task-item.completed .task-title {
          text-decoration: line-through;
        }

        .task-desc {
          font-size: 12px;
          color: var(--text-secondary);
          margin-top: 4px;
          line-height: 1.4;
        }

        .task-actions {
          display: flex;
          gap: 4px;
        }

        .complete-btn, .skip-btn {
          width: 24px;
          height: 24px;
          padding: 0;
          font-size: 12px;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .complete-btn {
          background: #4ade80;
          color: white;
        }

        .skip-btn {
          background: var(--bg-tertiary);
          color: var(--text-secondary);
        }

        .task-complete {
          padding: 16px;
          text-align: center;
          background: rgba(74, 222, 128, 0.1);
          color: #4ade80;
          font-size: 14px;
          font-weight: 500;
        }
      `}</style>
    </div>
  )
}
