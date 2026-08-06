# PR: v0.8-1 CardData single validator seam (Candidate 1 TOP)

> **目标分支**：`main`
> **源分支**：`feature/v0.7-undo-redo` (现在含 v0.7 + arch review + Candidate 1)
> **MR 链接**（gitcode）：https://gitcode.com/yishuangyz/1/merge_requests/new?source_branch=feature/v0.7-undo-redo

---

## 标题

`feat(card): v0.8-1 CardData single validator seam (Candidate 1 TOP)`

## 正文（粘贴到 MR 描述）

```markdown
## Summary

实施 `/improve-codebase-architecture` 报告 [[docs/architecture-review-2026-08-06.md]](../../raw/feature/v0.7-undo-redo/docs/architecture-review-2026-08-06.md) **TOP 候选 1**（Strong 强度），把 4 个 CardData rule-keeper 合并到单一 validator seam。

4 模块独立维护「CardData 由哪些字段组成」，加 1 个字段要改 4 处。返回类型有 4 种不一致（`boolean × 2` / `string[]` / `Partial<CardData>`），drift 是必然。这是 v0.9 AI JSON Schema 路径的前置唯一可信 source of truth。

**同时纳入**：[docs/architecture-review-2026-08-06.md](./architecture-review-2026-08-06.md) + [原始 HTML](./architecture-review-2026-08-06.html) — 5 个候选的完整决策记录（v0.8-1 / v0.8-2 / v0.8-3 / v0.9 路线图依据）。

## Commits

- `6953ee1` docs(arch): import /improve-codebase-architecture report (2026-08-06, post-v0.7)
- `63ddb3d` feat(card): v0.8-1 CardData single validator seam (Candidate 1 TOP)
- （继承自父分支）`9d54ee6` v0.7 history stack + undo/redo UI + shortcuts

## Changes

**新增**：
- `src/card/cardValidation.ts`
  - `parseCardData(value: unknown): CardData | null` — 唯一外部数据 → 完整 CardData 入口，覆盖 JSON 导入 / LLM 响应 / C# 反向解析三条路径
  - `validateCard(card: Partial<CardData>): string[]` — 编辑器用户可读错误文案（结构校验已下沉到 `parseCardData`）
- `src/card/cardValidation.test.ts` — 5 测试（合法解析 / keywords 补齐 / 类型枚举拒绝 / 保留 imagePath / 编辑器错误文案）

**删除（合并 4 个浅模块为 0）**：
- `src/utils/cardIO.ts` 中 `validateCardData` — 改用 `flatMap(parseCardData)`
- `src/utils/cardParser.ts` 中 `validate()` — 删
- `src/services/llm/adapters/base.ts` 中 `validateCardItem` + `normalizeCardItem` — 改用 `flatMap(parseCardData)`
- `src/services/FileService.ts` 中私有 `parseCardFromCode` (47 行) — 改用导出的公版

**签名升级**：
- `parseCardFromCode(code)` 返回类型 `Partial<CardData> | null` → `CardData | null`

**import 路径跟随**：
- `src/components/CardEditor.tsx`（仅 import 1 行 — 8/3 交接明令的禁区，**核心流程零改动**）
- `src/integration/integration.test.ts`
- `src/services/llm/adapters/base.test.ts`

净变化：**+213 / -169 行**（删 139 行未结算代码）。

## Verification

```bash
$ npx tsc --noEmit   # 0 errors
$ npx vitest run     # 292/292 通过
```

| 测试文件 | tests | 状态 |
|---|---:|:---:|
| `src/card/cardValidation.test.ts` | 5 | ✅ 新增 |
| `src/utils/cardIO.test.ts` | 11 | ✅ |
| `src/services/llm/adapters/base.test.ts` | 6 | ✅ 删除 `validateCardItem` 测试后减少 |
| `src/integration/integration.test.ts` | 26 | ✅ |
| （全部 18 个测试文件） | 292 | ✅ 全绿 |

## Compatibility / Risk

- **公共 API 变化**：
  - `parseCardFromCode` 返回 `CardData | null`（不再 `Partial<CardData> | null`）
  - `validateCard` 行为不变（仍返回 `string[]` 错误文案）
- **触及 `CardEditor.tsx` 核心流程**：**否**（仅 1 行 import 路径变更，遵循 8/3 交接约束）
- **触及 `types.ts` 字段**：**否**（向后兼容）

## Test Plan

- [ ] 自动化：`npx tsc --noEmit && npx vitest run`
- [ ] 手动：`npm run dev`，导入一张旧 JSON 卡牌（带 keywords）→ 仍能解析
- [ ] 手动：从 LLM 适配器（HTTPAdapter Mock）生成卡牌 → 走新 seam
- [ ] 手动：在编辑器中保存非法 cost（≥100 或 <0）→ 错误文案仍可读

## Reviewer Guide

- 重点看 `src/card/cardValidation.ts`（新 seam 的唯一入口）
- 重点看 `src/utils/cardParser.ts` 的 `parseCardFromCode`（签名升级，行为不变）
- 重点看 `src/services/llm/adapters/base.ts` 和 `src/utils/cardIO.ts`（旧 `validateCardData` / `validateCardItem` 完全消除）

## Next Steps（不在本 MR 范围）

按架构评审报告 §实施顺序：

| 候选 | 强度 | 计划版本 |
|---|:---:|:---:|
| 2. window-globals → factory seam | Strong | v0.8-2 |
| 3. connectError 入 hook | Worth exploring | v0.8-3 |
| 4. 快捷键 + isEditableTarget 抽 seam | Worth exploring | 等 CardEditor 接入撤销 |
| 5. kinds registry 注入 validateGraph | Speculative | v0.9 AI JSON Schema 决策后 |

## Related

- 设计依据：`docs/architecture-review-2026-08-06.md` § Candidate 1
- 上游：v0.7 history stack（`9d54ee6`）
- 后续债务：CONTEXT.md 自 v1.0（2026-08-03）未更新；ADR 体系停在 ADR-0004，建议新增 ADR-0005（history stack vs command pattern）
```

## Merge 后要做

1. 合并后清理本地 `feature/v0.7-undo-redo` 分支（用 `git branch -d` 或 `-D`）。
2. 在 `main` 上 bump 到 `0.8.0`。
3. 更新 `CONTEXT.md` 到 v1.1 — 把 v0.5.2 / v0.6 / v0.7 / v0.8-1 全部追上。
4. 新增 `ADR-0005-history-stack-undo-redo.md` — 沉淀 v0.7 的"快照栈 vs command pattern"决策。
5. 启动 v0.8-2（Candidate 2 — factory seam），用 `feature/v0.8-factory-seam` 新分支。

---

## 创建 MR 的两种方式

### 方式 A：网页（推荐，无需 gh CLI）

打开 `https://gitcode.com/yishuangyz/1/merge_requests/new?source_branch=feature/v0.7-undo-redo`

把上面 `## 正文（粘贴到 MR 描述）` 整段复制进 MR 描述框。

### 方式 B：命令（如果你之后装了 gh CLI）

```bash
gh mr create --base main --source feature/v0.7-undo-redo \
  --title "feat(card): v0.8-1 CardData single validator seam (Candidate 1 TOP)" \
  --body-file docs/pr-v0.8-card-seam.md
# 或者 atomgit 的 glab CLI:
glab mr create --target-branch main --source-branch feature/v0.7-undo-redo \
  --title "feat(card): v0.8-1 CardData single validator seam (Candidate 1 TOP)" \
  --description "$(sed -n '/```markdown$/,/```$/p' docs/pr-v0.8-card-seam.md | sed '1d;$d')"
```
