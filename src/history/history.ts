/** 通用不可变快照历史；Card、NodeGraph 都只把领域快照放在这里。 */
export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] }
}

export function commitHistory<T>(
  previous: HistoryState<T>,
  next: T,
  historyLimit = 100,
): HistoryState<T> {
  if (next === previous.present) return previous
  const basePast = previous.past.length >= historyLimit
    ? previous.past.slice(previous.past.length - historyLimit + 1)
    : previous.past
  return { past: [...basePast, previous.present], present: next, future: [] }
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) return state
  const present = state.past[state.past.length - 1]
  return {
    past: state.past.slice(0, -1),
    present,
    future: [state.present, ...state.future],
  }
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) return state
  const present = state.future[0]
  return {
    past: [...state.past, state.present],
    present,
    future: state.future.slice(1),
  }
}
