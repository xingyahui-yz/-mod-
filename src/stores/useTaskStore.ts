import { create } from 'zustand'
import { Task, TUTORIAL_STEPS } from '../types'

interface TaskStore {
  tasks: Task[]
  currentTaskId: string | null
  isTaskMode: boolean
  showTaskGuide: boolean

  // Actions
  startTasks: () => void
  completeTask: (taskId: string) => void
  skipTask: (taskId: string) => void
  nextTask: () => void
  toggleTaskGuide: () => void
  resetTasks: () => void

  // Selectors
  getCurrentTask: () => Task | null
  getProgress: () => { completed: number; total: number }
}

const createInitialTasks = (): Task[] =>
  TUTORIAL_STEPS.map(step => ({
    id: step.id,
    title: step.title,
    description: step.description,
    status: 'pending' as const
  }))

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: createInitialTasks(),
  currentTaskId: TUTORIAL_STEPS[0]?.id || null,
  isTaskMode: false,
  showTaskGuide: true,

  startTasks: () => {
    set({
      isTaskMode: true,
      tasks: createInitialTasks(),
      currentTaskId: TUTORIAL_STEPS[0]?.id || null
    })
  },

  completeTask: (taskId: string) => {
    set(state => {
      const tasks = state.tasks.map(t =>
        t.id === taskId ? { ...t, status: 'completed' as const } : t
      )
      // Auto advance to next task
      const currentIndex = tasks.findIndex(t => t.id === taskId)
      const nextTask = tasks[currentIndex + 1]
      return {
        tasks,
        currentTaskId: nextTask?.id || null
      }
    })
  },

  skipTask: (taskId: string) => {
    set(state => {
      const tasks = state.tasks.map(t =>
        t.id === taskId ? { ...t, status: 'skipped' as const } : t
      )
      // Auto advance to next task
      const currentIndex = tasks.findIndex(t => t.id === taskId)
      const nextTask = tasks[currentIndex + 1]
      return {
        tasks,
        currentTaskId: nextTask?.id || null
      }
    })
  },

  nextTask: () => {
    const { tasks, currentTaskId } = get()
    if (!currentTaskId) return

    const currentIndex = tasks.findIndex(t => t.id === currentTaskId)
    const nextTask = tasks[currentIndex + 1]

    if (nextTask) {
      set({ currentTaskId: nextTask.id })
    }
  },

  toggleTaskGuide: () => {
    set(state => ({ showTaskGuide: !state.showTaskGuide }))
  },

  resetTasks: () => {
    set({
      tasks: createInitialTasks(),
      currentTaskId: TUTORIAL_STEPS[0]?.id || null,
      isTaskMode: false
    })
  },

  getCurrentTask: () => {
    const { tasks, currentTaskId } = get()
    return tasks.find(t => t.id === currentTaskId) || null
  },

  getProgress: () => {
    const { tasks } = get()
    const completed = tasks.filter(t => t.status === 'completed').length
    return { completed, total: tasks.length }
  }
}))
