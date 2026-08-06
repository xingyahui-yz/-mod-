# ADR-0005：节点编辑器撤销 / 重做 — History Stack（不可变快照），非 Command Pattern

> 状态：已接受 · 日期：2026-08-06 · 来源：v0.7 实施（commit `9d54ee6`）+ `/improve-codebase-architecture` 评审（2026-08-06，候选 5 之外）
> 适用范围：`src/node-editor/useNodeGraph.ts`（节点图编辑器的撤销 / 重做机制）

## 背景（Context）

节点编辑器达到 v0.7 时，用户已能增/删/移节点、建立/断开连线、导入 JSON，但**没有任何撤销 / 重做**。按 8/3 交接的约束"v0.5 之后"才做此功能，v0.7 落地窗口到了。

**问题**：用什么机制记录"用户做了什么"？

候选有两种传统答案：

- **A. Command Pattern** — 每步操作记录 (action, inverseAction)，重做 = 跑 inverse + redo
- **B. History Stack（不可变快照）** — 每步把旧图整体推入 past 栈

## 决策（Decision）

**采用 History Stack（不可变快照栈），不采用 Command Pattern。**

`useNodeGraph` 内部维护 `HistoryState { past: NodeGraph[], present: NodeGraph, future: NodeGraph[] }`：

- 成功 mutation 且 graph 引用变化：旧 present 推 past，新图入 present，清空 future
- graph 引用相等（no-op）：不入栈、不动 metadata
- undo：present → future，past 尾弹到 present
- redo：present → past，future 尾弹到 present
- 新 mutation 清空 future（分叉后重做失效）
- HISTORY_LIMIT = 100（实现常量；超过则裁剪最旧）

`undo / redo / canUndo / canRedo` 作为 hook 的返回字段；编辑器和 UI 不感知栈结构。

## 备选方案（Alternatives Considered）

### 备选 A：Command Pattern

- **结构**：
  ```ts
  interface Command {
    do(state: NodeGraph): NodeGraph
    undo(state: NodeGraph): NodeGraph
  }
  ```
- **优点**：内存更省（操作只需记录增量参数）；多分支工作流 / 协作合并可派生
- **缺点**：
  - **必须为每个 mutation 维护一对逆操作**。删除节点（连同边）要 reverse-create 节点 + 边；导入 JSON 要存整张旧图作为"逆"。
  - **导入路径逻辑泄漏到 UI**：JSON 反向重构 graph 元数据（kind registry 校验等）必须包成 Command，编辑器调用点会变复杂。
  - **`connect` 失败需要 no-op Command** 或在调用方做条件分支 — 与 React 18 setState updater 的"返回同引用表示无变化"约定（v0.6 已立）不一致。
  - 测试矩阵需要"n 个 mutation × 2（do/undo）"——规模翻倍。
  - **多分支 / 协作合并不是 v0.7 的目标**（详见 8/6 设计文档非目标）。

### 备选 B：History Stack（已选）

- **优点**：
  - **直接复用 graph.ts 已有的纯函数**——`addNode / removeNode / moveNode / connect / disconnect / importJson` 都已经返回新引用或同引用，**"no-op 判定"免费**。
  - **快照大小可控**：单图、单用户、本地优先；MVP 量级下内存成本 < 1MB/graph × 100 = 100MB 上限，绝对量级无压力。
  - **测试可重读** `graph.ts` 的 57 个现有测试，v0.7 新增 13 个 undo/redo 测试只覆盖"栈行为"，不重复测纯函数。
  - 实现复杂度低：`commit(next)` 一个 helper 即统一所有 mutation。
- **缺点**：
  - 历史占内存（每张图 = 节点 + 边的快照）
  - 不能跨实体共享 history（每个 `useNodeGraph` 实例独立）—— 这是设计选择不是缺陷
  - 持久化需要全图序列化（暂未做；重启编辑器历史归零，明确写在设计文档非目标里）

## 关键发现

### v0.6 闭包 bug 必须修

v0.6 重写 `connect` 用 closure 捕获 `outcome`，React 18 setState updater **非同步执行**，导致 closure 在 setGraph 返回后读到旧值。v0.6 测试只覆盖成功路径（初始值恰好匹配），未暴露。

History stack 要求 `connect` 返回的 `outcome` 在调用返回时已经反映到 present graph，否则会出现"history 记录了 X 但 outcome 说 ok:false"的不一致。修复：用 `flushSync` 包 setHistory 强制同步（v0.7 commit `ba24469` 之前已修过）。

### `no-op` 必须不入栈

`graph.ts` 已立约："引用相等表示无变化"。History stack 必须 honour 同约定：

```ts
const commit = (prev: HistoryState, next: NodeGraph): HistoryState => {
  if (prev.present === next) return prev   // no-op, 不入栈
  return {
    past: trim([...prev.past, prev.present]),
    present: next,
    future: []
  }
}
```

否则 `moveNode(x,y)` 即使没真移动也会占一格历史，用户按 5 次 Cmd+Z 才回到起点——破坏信任。

### `flushSync` 的代价

每次 `connect` 用 `flushSync` 强制一次同步 re-render。编辑器交互频率下无感（手速 < 200ms/次）。**批量导入需后续优化**（设计文档 §性能已注明）。

## 后果（Consequences）

### 正面

- **实现统一**：5 个 mutation 共用 `commit(next)` 一个 helper — 集中"如何记录历史"的代码到一处。
- **测试分工清晰**：graph.ts 不动，v0.7 undo/redo 测试只覆盖"栈行为"。
- **跨编辑器复用预备**：当未来 CardEditor / CharacterEditor / EventEditor 等其他实体接入节点编辑器（v0.9+），每个实例用同一个 hook，**默认值即可**为它们提供撤销 / 重做。
- **不需要持久化序列化即可工作**：重启即丢弃历史，符合 MVP 节奏。

### 负面

- **HISTORY_LIMIT = 100 是硬编码**——v0.7 控制台打印提示 v0.10+ 才把它做成可配置（写进 `useNodeGraph(id, type, initial, { historyLimit?: number })`）。
- **持久化暂不做**——重启编辑器历史归零。如果未来编辑会话很长（v0.10+），需要补设计文档。
- **快捷键全局监听**——`window` keydown 在所有当前和未来编辑器生效；如果未来需要画布内 scope 化，再细化 focus 范围（候选 4 候选方向之一）。

## 验证（Validation）

- [x] 282 个 graph + editor 测试全绿（v0.7 提交时刻）
- [x] v0.7 + candidate 1 = 292/292 测试绿
- [ ] 实机手动测：连续 200 步 mutation 不崩不卡
- [ ] 实机手动测：撤销 / 重做按钮 disabled 状态正确

## 修订记录

| 日期 | 变更 |
|---|---|
| 2026-08-06 | v1.0 初始建立 — v0.7 实施后的回溯性 ADR |
