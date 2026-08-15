import { describe, expect, it } from 'vitest'
import { commitHistory, createHistory, redoHistory, undoHistory } from './history'

describe('generic immutable history', () => {
  it('no-op 保持引用，提交清空 redo，undo/redo 只移动快照', () => {
    const first = { value: 1 }
    const second = { value: 2 }
    const initial = createHistory(first)
    expect(commitHistory(initial, first)).toBe(initial)

    const committed = commitHistory(initial, second)
    expect(committed).toEqual({ past: [first], present: second, future: [] })
    expect(undoHistory(committed)).toEqual({ past: [], present: first, future: [second] })
    expect(redoHistory(undoHistory(committed))).toEqual(committed)
  })

  it('historyLimit 只保留最近的 past 快照，redo 分叉会被清空', () => {
    const a = createHistory('a')
    const b = commitHistory(a, 'b', 2)
    const c = commitHistory(b, 'c', 2)
    const d = commitHistory(c, 'd', 2)
    expect(d.past).toEqual(['b', 'c'])
    const undone = undoHistory(d)
    expect(commitHistory(undone, 'new', 2).future).toEqual([])
  })

  it('空 past/future 的 undo/redo 保持引用', () => {
    const state = createHistory(1)
    expect(undoHistory(state)).toBe(state)
    expect(redoHistory(state)).toBe(state)
  })
})
