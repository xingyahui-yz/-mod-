/**
 * 状态管理深度测试 - useTaskStore
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from './useTaskStore'

beforeEach(() => {
  useTaskStore.setState({
    tasks: [],
    currentTaskId: null,
    isTaskMode: false,
    showTaskGuide: true
  })
  // 重置任务池
  useTaskStore.getState().resetTasks()
})

describe('useTaskStore 任务生命周期', () => {
  it('初始状态有任务列表（来自 TUTORIAL_STEPS）', () => {
    const { tasks, currentTaskId } = useTaskStore.getState()
    expect(tasks.length).toBeGreaterThan(0)
    expect(tasks[0].status).toBe('pending')
    expect(currentTaskId).toBe(tasks[0].id)
  })

  it('startTasks 进入任务模式', () => {
    useTaskStore.getState().startTasks()
    const s = useTaskStore.getState()
    expect(s.isTaskMode).toBe(true)
    expect(s.currentTaskId).toBe(s.tasks[0].id)
  })

  it('completeTask 推进到下一个任务', () => {
    useTaskStore.getState().startTasks()
    const firstId = useTaskStore.getState().currentTaskId!
    useTaskStore.getState().completeTask(firstId)

    const s = useTaskStore.getState()
    expect(s.tasks.find(t => t.id === firstId)?.status).toBe('completed')
    // 推进到第二个
    expect(s.currentTaskId).toBe(s.tasks[1].id)
  })

  it('skipTask 标记为 skipped 并推进', () => {
    useTaskStore.getState().startTasks()
    const firstId = useTaskStore.getState().currentTaskId!
    useTaskStore.getState().skipTask(firstId)

    const s = useTaskStore.getState()
    expect(s.tasks.find(t => t.id === firstId)?.status).toBe('skipped')
    expect(s.currentTaskId).toBe(s.tasks[1].id)
  })

  it('完成最后一个任务后 currentTaskId 为 null', () => {
    useTaskStore.getState().startTasks()
    let s = useTaskStore.getState()
    while (s.currentTaskId) {
      s.currentTaskId && useTaskStore.getState().completeTask(s.currentTaskId)
      s = useTaskStore.getState()
    }
    expect(s.currentTaskId).toBeNull()
  })

  it('getCurrentTask 返回当前任务对象', () => {
    useTaskStore.getState().startTasks()
    const task = useTaskStore.getState().getCurrentTask()
    expect(task).not.toBeNull()
    expect(task?.id).toBe(useTaskStore.getState().currentTaskId)
  })

  it('getProgress 统计 completed', () => {
    useTaskStore.getState().startTasks()
    const ids = useTaskStore.getState().tasks.map(t => t.id)
    useTaskStore.getState().completeTask(ids[0])
    useTaskStore.getState().completeTask(ids[1])

    const p = useTaskStore.getState().getProgress()
    expect(p.completed).toBe(2)
    expect(p.total).toBe(useTaskStore.getState().tasks.length)
  })

  it('nextTask 不会跳过末尾', () => {
    useTaskStore.getState().startTasks()
    const lastId = useTaskStore.getState().tasks.at(-1)!.id
    useTaskStore.setState({ currentTaskId: lastId })
    useTaskStore.getState().nextTask()
    expect(useTaskStore.getState().currentTaskId).toBe(lastId)
  })

  it('resetTasks 重置全部状态', () => {
    useTaskStore.getState().startTasks()
    useTaskStore.getState().completeTask(useTaskStore.getState().tasks[0].id)
    useTaskStore.getState().resetTasks()

    const s = useTaskStore.getState()
    expect(s.isTaskMode).toBe(false)
    expect(s.tasks.every(t => t.status === 'pending')).toBe(true)
  })

  it('toggleTaskGuide 切换可见性', () => {
    const before = useTaskStore.getState().showTaskGuide
    useTaskStore.getState().toggleTaskGuide()
    expect(useTaskStore.getState().showTaskGuide).toBe(!before)
  })
})