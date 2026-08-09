# PR: v0.8-2 factory seam (Candidate 2)

> **目标分支**：`main`
> **源分支**：`feature/v0.8-factory-seam`
> **关联**：`docs/architecture-review-2026-08-06.md` § Candidate 2
> **依赖**：v0.8-1 CardData seam 已合入（`ae0c558`）

---

## 标题

`feat(stores+services): v0.8-2 factory seam (Candidate 2 — Strong)`

## 正文（粘贴到 MR 描述）

```markdown
## Summary

实施 [/improve-codebase-architecture 报告](../../raw/feature/v0.8-factory-seam/docs/architecture-review-2026-08-06.md) **Candidate 2**（Strong 强度），把模块级 window globals 改为工厂 seam。

两个全局 mutable bindings 各自泄漏抽象：

  - `src/stores/useAIStore.ts`: `(window as any).__adapterFactory` — 改 `createAIStore({ factory })`
  - `src/services/FileService.ts`: `let api = (window as any).electronAPI` — 改 `createFileService({ api })`

每个测试自己创建实例，工厂闭包捕获依赖，不再共享模块级 mutable。生产单例在 `main.tsx` 用 `installFileService({ api })` 接线。`(window as any)` 类型丢失问题一并消除。

## Commits

- `7b6b46a` chore: v0.8 housekeeping — version bump + ADR-0005 + CONTEXT v1.1
- （本次）feat(stores+services): v0.8-2 factory seam (Candidate 2 — Strong)

## Changes

### 新 API

**`src/stores/useAIStore.ts`** — 删除:
  - `(window as any).__adapterFactory` 全局
  - `setAdapterFactory(factory)` 函数
  - 模块级 `useAIStore` 直接 export
  - `defaultFactory` 顶层常量

新增:
```ts
export function createAIStore(deps: { factory: AdapterFactory; persistName?: string }): AIStore
export type AIStore = ReturnType<typeof createAIStore>
export const useAIStore: AIStore = createAIStore({ factory: createAdapter })  // 产线单例
```

`persistName` 参数化让测试用独立 localStorage 隔离（zustand persist 中间件按 name 写 storage）。

**`src/services/FileService.ts`** — 删除:
  - `let api: ElectronAPI = (window as any).electronAPI || noOpApi` 顶层可变 binding
  - `setApi(newApi)` 函数

新增:
```ts
export function createFileService(deps: { api: ElectronAPI }): FileService
export function installFileService(deps: { api: ElectronAPI }): void  // 产线入口
// + FileService interface（所有方法签名）
// + 兼容: openProjectDirectory() 等 module-level 函数仍然 export,
//   内部路由到 lazy-created default service
```

`FileService` 接口定义完整 seam 形状（Open/Closed）。`createFileService` 是实现，`installFileService` 是产线 wiring。

### 测试隔离（核心证明）

`src/stores/useAIStore.test.ts`:
  - `beforeEach` 加 `localStorage.clear()` — 防止上一个测试残留 `apiKey`/`isConfigured` 干扰
  - 每个测试独立 `createAIStore({ factory, persistName })`
  - **新增测试**："每个 store 持有独立的 factory 闭包 — 不共享模块级全局"
    并发两个 store (successFactory + errorFactory) 互不影响

`src/integration/integration.test.ts`:
  - 5 个 FileService 测试改用 `createFileService({ api: mockApi })`
  - 不再调 `FileService.setApi()` (已删除)

`src/components/components.test.tsx`:
  - 2 个 CardEditor 渲染测试改用 `installFileService({ api: mockApi })`
  - 组件通过 `FileService.foo()` 模块 re-export 间接用 mock

### 生产接线

`src/main.tsx`:
  - React 渲染前调 `installFileService({ api: window.electronAPI || undefined })`
  - 产线 Electron preload 注入 `window.electronAPI` 后, 所有 FileService 调用走 prod adapter

`useAIStore` 是模块级单例 (`createAIStore({ factory: createAdapter })`), 组件直接 `useAIStore()` 调用, 不需额外接线.

## Verification

```bash
$ npx tsc --noEmit     # 0 errors
$ npx vitest run       # 293/293 通过 (原 292 + 新增 1 factory-isolation test)
```

| 测试文件 | tests | 状态 |
|---|---:|:---:|
| `src/stores/useAIStore.test.ts` | 10 | ✅ +1 (factory-isolation) |
| `src/integration/integration.test.ts` | 26 | ✅ (5 FileService 测试改 factory) |
| `src/components/components.test.tsx` | 18 | ✅ (2 CardEditor 测试改 installFileService) |
| （全部 18 个测试文件） | **293** | ✅ 全绿 |

## Compatibility / Risk

- **公共 API 变化**:
  - `useAIStore` 仍 export（产线单例），保持组件代码 `useAIStore()` 不变
  - `FileService.foo()` 等模块函数仍 export（route 到 default service），保持现有 import 兼容
  - **删除**：`setAdapterFactory`, `setApi`（只有测试用过，已同步迁移）
- **触及 `App.tsx` / `main.tsx`**:
  - `main.tsx` +8 行：生产 wiring
  - `App.tsx` 未改动
- **触及核心流程**: 否 — `useAIStore` 与 `FileService` 公共 API 形态未变

## Test Plan

- [x] 自动化: `npx tsc --noEmit && npx vitest run`
- [ ] 手动: 启动 dev server, 验证 AIGenerator 能创建 store / 调 prod factory
- [ ] 手动: 验证 CardEditor 在 project 路径下能正常加载卡牌 (走 FileService → installFileService 路径)

## Reviewer Guide

- 重点看 `src/stores/useAIStore.ts`（factory seam + persistName 参数化）
- 重点看 `src/services/FileService.ts`（FileService interface + createFileService + 兼容 re-export）
- 重点看 `src/stores/useAIStore.test.ts` 的"每个 store 持有独立的 factory 闭包"测试 — 工厂 seam 的核心证明

## Next Steps（不在本 MR 范围）

按架构评审报告 §实施顺序：

| 候选 | 强度 | 计划版本 |
|---|:---:|:---:|
| 3. connectError 入 hook | Worth exploring | v0.8-3 |
| 4. 快捷键 + isEditableTarget 抽 seam | Worth exploring | 等 CardEditor 接入撤销 |
| 5. kinds registry 注入 validateGraph | Speculative | v0.9 AI JSON Schema |

## Related

- 上游决策: `docs/adr/0005-history-stack-undo-redo.md`
- 评审报告: `docs/architecture-review-2026-08-06.md` § Candidate 2
- 上一个 PR: v0.8-1 CardData seam (commit `ae0c558`)
- 后续债务: CONTEXT.md 已同步到 v1.1（housekeeping commit），ADR-0006 (factory seam) 备选 — 可在后续 review 决定是否新增
```

## Merge 后要做

1. 合并后清理本地 `feature/v0.8-factory-seam` 分支
2. 启动 v0.8-3 (Candidate 3 — connectError 入 hook)
3. （可选）新增 ADR-0006（factory seam 决策），或在 v0.9 统一回溯一次

---

## 创建 MR 的两种方式

### 方式 A：网页（推荐，无需 gh CLI）

打开 `https://gitcode.com/yishuangyz/1/merge_requests/new?source_branch=feature/v0.8-factory-seam`

把上面 `## 正文（粘贴到 MR 描述）` 整段复制进 MR 描述框。

### 方式 B：命令（如果你之后装了 gh CLI）

```bash
gh mr create --base main --source feature/v0.8-factory-seam \
  --title "feat(stores+services): v0.8-2 factory seam (Candidate 2 — Strong)" \
  --body-file docs/pr-v0.8-2-factory-seam.md
```