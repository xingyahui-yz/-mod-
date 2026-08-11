# PR: v0.8-3 connectError lifecycle into useNodeGraph (Candidate 3)

> **目标分支**：`main`
> **源分支**：`feature/v0.8-factory-seam`
> **关联**：`docs/architecture-review-2026-08-06.md` § Candidate 3
> **依赖**：v0.8-2 factory seam（本次同分支）

---

## 标题

`feat(node-editor): v0.8-3 connectError 生命周期入 hook (Candidate 3 — Worth exploring)`

## 正文（粘贴到 MR 描述）

```markdown
## Summary

实施架构评审报告 **Candidate 3**（Worth exploring 强度）：
把 `connectError` 生命周期从 `RelicEditor` 的 glue 层下沉到 `useNodeGraph` hook。

原本每次 `ng.connect` 失败，组件都要：
```ts
const result = ng.connect(from, to)
if (!result.ok && result.reason) {
  setError(`连线失败：${result.reason}`)
} else if (result.ok) {
  setError('')
}
```

错误消息硬编码在组件里；`setError` 还要和 codegen 错误抢同一个 state；
切换实体时遗留错误也不会清。**hook 是 connect 的 seam，错误应跟 seam 一起**。

实施后组件变成纯展示：
```tsx
onConnect={ng.connect}  // 直接传, 不再 wrap
{ng.connectError && (
  <div data-testid="connect-error">
    <span>{ng.connectError}</span>
    <button onClick={ng.clearConnectError} aria-label="关闭连线错误">×</button>
  </div>
)}
```

## Changes

### Hook 接口扩展 (`src/node-editor/useNodeGraph.ts`)

`UseNodeGraphReturn` 新增两个成员：
```ts
/** v0.8-3 (Candidate 3): connectError 生命周期 — hook 拥有 */
connectError: string | null
clearConnectError: () => void
```

`connectFn` 内部接入：
```ts
if (r.ok) {
  outcome = { ok: true }
  setConnectError(null)                       // 成功自动清除
  return commit(prev, r.graph, historyLimit)
}
outcome = r
setConnectError(`连线失败：${r.reason}`)       // 失败设置可读错误
return prev                                   // 失败不入栈
```

`useEffect`（entity 切换）也加 `setConnectError(null)` — 切换视为新上下文。

### 编辑器纯展示化 (`src/relic/RelicEditor.tsx`)

**删除**：
- `handleConnect` glue（5 行包装函数）
- `setError(\`连线失败：${result.reason}\`)` glue
- 成功 connect 时清空 `error` 的 glue

**新增**（JSX）：
```tsx
{ng.connectError && (
  <div className="connect-error" data-testid="connect-error">
    <span>{ng.connectError}</span>
    <button
      onClick={ng.clearConnectError}
      data-testid="connect-error-clear"
      type="button"
      aria-label="关闭连线错误"
    >×</button>
  </div>
)}
```

本地 `error` state 现在只承担 codegen 错误 — 不再被 connect 错误污染。

### 测试 (`+8 tests, 301 total`)

**`src/node-editor/node-editor.test.tsx`** — 新增 `useNodeGraph connectError 生命周期 (v0.8-3)` 描述块（6 tests）：
1. 初始 `connectError = null`，暴露 `clearConnectError`
2. 成功 connect 不写错误，且清除之前的遗留错误
3. 失败 connect 设置 `连线失败：${reason}` 字符串
4. `clearConnectError()` 把错误清回 null
5. entity 切换视为新上下文，清掉遗留 `connectError`
6. 失败 connect 不入栈（与 `canUndo` 状态一致）

**`src/relic/RelicEditor.test.tsx`** — 新增 `RelicEditor connectError UI (v0.8-3)` 描述块（2 tests）：
1. 初始状态：无 `connect-error` 元素（null → 不渲染）
2. 成功 connect 后仍无 `connect-error` 元素（hook 自动清除）

## Verification

```bash
$ npx tsc --noEmit     # 0 errors
$ npx vitest run       # 301/301 通过 (原 293 + 6 hook + 2 editor UI)
```

| 测试文件 | tests | 状态 |
|---|---:|:---:|
| `src/node-editor/node-editor.test.tsx` | 50 | ✅ +6 (connectError 生命周期) |
| `src/relic/RelicEditor.test.tsx` | 18 | ✅ +2 (connectError UI) |
| （全部 18 个测试文件） | **301** | ✅ 全绿 |

## Compatibility / Risk

- **公共 API 扩展**（非破坏）:
  - `UseNodeGraphReturn` 新增 `connectError` + `clearConnectError` — 其他编辑器（如果有）选择不用即可
  - `RelicEditor` 的 `onConnect` 形状不变（仍是 `(from, to) => result`）
- **触及 `RelicEditor.tsx`**:
  - 删除 `handleConnect` (-5 行) + 新增 JSX 块 (+13 行) + 重写文件头注释
- **触及核心流程**: 否 — `connect` 返回值 `{ ok, reason? }` 未变

## Test Plan

- [x] 自动化：`npx tsc --noEmit && npx vitest run`
- [ ] 手动：dev server 启动后，触发一次非法连线（例如对 trigger 的 output 连到自身），验证 `connect-error` 元素出现且 × 按钮可清除

## Reviewer Guide

- 重点看 `src/node-editor/useNodeGraph.ts` 的 `connectFn`（成败两条路径都更新 `connectError`）
- 重点看 `src/relic/RelicEditor.tsx` 的 JSX（编辑器只是 observer，没有 glue）
- 重点看 `src/node-editor/node-editor.test.tsx` 的"成功 connect 不写错误, 且清除之前的遗留错误"测试 — 这是 Candidate 3 的核心承诺（hook 自洽）

## Next Steps（不在本 MR 范围）

按架构评审报告 §实施顺序：

| 候选 | 强度 | 计划版本 |
|---|:---:|:---:|
| 4. 快捷键 + isEditableTarget 抽 seam | Worth exploring | 等 CardEditor 接入撤销 |
| 5. kinds registry 注入 validateGraph | Speculative | v0.9 AI JSON Schema |

## Related

- 上游决策: `docs/adr/0005-history-stack-undo-redo.md`
- 评审报告: `docs/architecture-review-2026-08-06.md` § Candidate 3
- 上一个 PR: v0.8-2 factory seam（同分支未推送）
- 上上游 PR: v0.8-1 CardData seam (commit `ae0c558`)
```

## 创建 MR

打开 `https://gitcode.com/yishuangyz/1/merge_requests/new?source_branch=feature/v0.8-factory-seam`

把上面 ```` ```markdown ```` 块整段复制进 MR 描述框。
