# 架构评审 — mod-studio（v0.7 后）

> 来源：`/improve-codebase-architecture` skill · 生成时间：2026-08-06 15:50
> 词汇表：codebase-design（module / interface / seam / depth / adapter / leverage / locality）
> 评审时刻：285 测试 · HEAD = `24fd03a`（v0.7 实施前）
> 原始 HTML：`docs/architecture-review-2026-08-06.html`

## 范围

`src/node-editor/` · `src/relic/` · `src/services/llm/` · `src/stores/` · `src/utils/`

## 5 个候选（按强度排序）

| # | 候选 | 强度 | 范围 | 报告时刻 | 当前状态（2026-08-06） |
|---:|---|---|---|---|---|
| **TOP** | 1. 把 4 个 CardData rule-keeper 合并到单一 validator | Strong | `cardIO` · `cardParser` · `base.ts` · `FileService` | 待办 | ✅ **Candidate 1 已在工作树实施完成，未提交** |
| 2 | window-globals 改成 factory seam（ports & adapters） | Strong | `useAIStore.ts:72, 129-134` · `FileService.ts:39-54` | 待办 | ❌ 未做 |
| 3 | 把 connectError 生命周期搬到 `useNodeGraph` | Worth exploring | `RelicEditor.tsx:48-53, 80-84` · `useNodeGraph.ts:115-137` | 待办 | ❌ 未做 |
| 4 | 快捷键监听 + `isEditableTarget` 提到可复用 seam | Worth exploring | `RelicEditor.tsx:79-96` · future CardEditor | 待办 | ❌ 未做 |
| 5 | kinds registry 注入 `validateGraph` | Speculative | `graph.ts:355-366` · `kinds.ts` | 待办 | ❌ 未做 |

> 标识规则：Strong = 杠杆明显、低风险；Worth exploring = 有价值但要先验；Speculative = 取决于未来规划（v0.9 AI JSON Schema）。

---

## Candidate 1（TOP）— 4 个 CardData rule-keeper 合并为 1

### Before（4 个浅模块平行维护）

```
shallow ←─leak:duplicate rules─→ shallow
cardIO      : validateCardData(card): card is CardData
cardParser  : validate(Partial<CardData>): string[]
base.ts     : validateCardItem(any): boolean
            + normalizeCardItem(any): CardData
FileService : parseCardFromCode(code): Partial<CardData>
              (私有副本)
```

返回类型 4 种不一致（`boolean` × 2 / `string[]` / `Partial<CardData>`），加 1 个字段需要改 4 处。

### After（1 个深模块，4 个调用方走 seam）

```
deep ←─seam─→ 4 callers
cardValidation.ts
  parseCardData(value: unknown): CardData | null
  validateCard(card: Partial<CardData>): string[]
```

`parseCardFromCode` 签名升级到 `CardData | null`（不再是 `Partial<CardData>`）。

### 评估（报告原文）

✓ Locality — 1 处可修
✓ Leverage — 4 调用方 / 1 模块
✓ 删 3 个浅包装
✓ 测试集中在 1 个接口
✓ Deletion test（pass-through）通过
✓ CardData（不是 Partial）全链路统一
✓ **解锁 v0.9 AI JSON Schema 路径**（唯一可信 source of truth）

---

## Candidate 2 — window-globals → factory seam

### Before（模块级可变全局）

```ts
// useAIStore.ts
let factory = window.__adapterFactory    // (window as any) — 无类型

// FileService.ts
let api = window.electronAPI             // (window as any) — 无类型
```

并行测试会互相覆盖全局；TypeScript 放弃；生产从不写 fallback 分支。

### After（Zustand factory + ports & adapters）

```ts
createAIStore({ factory })    // prod adapter
createFileService({ api })    // in-memory test adapter
// 每个测试实例化自己的 store
// prod 在 main.tsx 启动时接入
```

~30 LOC 改动。2 个适配器（prod + in-memory test）正当化 seam。

---

## Candidate 3 — connectError 生命周期入 hook

### Before（编辑器镜像 hook 语义）

```tsx
// RelicEditor.tsx
const [error, setError] = useState<string>('')

// hook 只暴露 connect() 返回 { ok, reason }
// 编辑器手动调用 setError('连线失败：' + reason)
```

hook 知道 `flushSync` 语义；编辑器必须 mirror 它。泄漏 hook 的实现到 UI。

### After（hook 拥有错误，编辑器观察）

```ts
// useNodeGraph.ts
connectError: string | null
clearConnectError(): void
```

成功时自动清除。编辑器纯展示：`useEffect(ng.err)` → render `<Error />`。

---

## Candidate 4 — 快捷键 + isEditableTarget 抽 seam

### Before（藏在 RelicEditor 里）

```tsx
// RelicEditor.tsx:79-96
useEffect(() => {
  window.addEventListener('keydown', handler)
}, [ng])    // deps: [ng] → 每渲染重注册监听
```

未来 CardEditor 要 copy-paste 同一份逻辑。`isEditableTarget` 是私有 fn。

### After（可复用 hook）

```ts
// src/hooks/useGlobalUndoShortcut.ts
useGlobalUndoShortcut({ undo, redo })  // 稳定 deps

// src/utils/dom.ts
export function isEditableTarget(e: EventTarget): boolean
```

CardEditor 接入：传 2 个回调。

---

## Candidate 5 — kinds registry 注入 validateGraph

### Before（validator 只查字符串）

```ts
// graph.ts validateGraph
// 检查 data.event / data.kind 是 string
// 但不查是否在 kinds registry
// { event: "bogusEvent" } 通过验证
```

### After（可选注入，保持 purity）

```ts
validateGraph(obj, options?: {
  knownEvents?: Set<string>
  knownKinds?: Set<string>
})
```

调用方（deserialize 路径）从 `kinds.ts` 注入。`graph.ts` 保持不 import relic 层。

✓ 可选参数 — 不破坏 schema
✓ graph.ts 不反向依赖 relic
✓ 提前拦住 bogus event
✓ AI JSON Schema 路径（v0.9）复用

---

## 报告没有覆盖 / 后续自补

- ✅ Candidate 1 已完成实施（工作树 7 个 M + `src/card/` 新目录）
- ⏸ Candidate 2-5 仍未做
- ⏸ 新发现的债务：`HISTORY_LIMIT = 100` 硬编码 + `useEffect [ng]` 监听重注册 + `flushSync` 在 connect 时强制 re-render
- ⏸ ADR 体系停滞：v0.7 的"快照栈 vs command pattern"决策应有 ADR-0005
- ⏸ CONTEXT.md 自 v1.0（2026-08-03）以来未更新

## 实施顺序建议

1. **Candidate 1**（实施已完成）→ commit + PR
2. **Candidate 2**（Strong，最小杠杆最大）→ 用 Candidate 1 同套合约先测先验
3. **Candidate 3**（与 v0.7 flushSync 语义债直接相关）
4. **Candidate 4** 等 CardEditor 真要接入撤销
5. **Candidate 5** 等 v0.9 AI JSON Schema 决策
