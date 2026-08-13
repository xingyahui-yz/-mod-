# v0.9 Card 节点编辑器：原位升级现有编辑器并保持单一 Card 模型

## Problem Statement

当前 Card 编辑流程、NodeGraph、AI 生成和项目文件路径彼此分离。正常项目加载依赖反向解析 `scripts/Cards/*.cs`，Card 仍以数组索引或名称识别，无法无损保存节点图、统一撤销、恢复生成同步状态，也容易在接入节点编辑器时产生第二套 Card 模型。

v0.9 需要原位升级现有编辑器：一张 Card 的基本属性与行为图必须由同一个模型、Store、编辑器入口和项目文档管理。`.modstudio` 成为唯一权威项目源数据，C# 仅为显式生成产物；C# 反向解析只能用于用户主动启动的一次性旧项目迁移，不能继续作为正常加载或同步路径。

## Solution

- 使用不可变 PascalCase ASCII Card ID 作为文档名、类名、生成文件名和 Store 身份；名称只负责展示。
- 每张 Card 由一个带版本的 Card Document 原子保存基本属性、NodeGraph 和最近成功生成指纹。
- 结构安全的半成品允许作为草稿自动保存；只有生成语义完整时才能显式更新 C#。
- Card 支持多个不同 trigger 根；同类 trigger 唯一，每个 trigger 拥有独占的线性 effect 链，空 trigger 只能存在于草稿。
- effect 接收者只由目标化 kind 表达。v0.9 只闭环 Card 的 Self/Owner 语义，Relic Any/EventTarget 延后。
- Card 表单和行为图共享完整快照历史；连续输入、一次拖动和离散操作按用户意图形成事务。
- 正常加载只扫描 `.modstudio/cards/`；旧 C# parser 隔离到显式 legacy import 模块，导入为空图迁移草稿并保护旧 C#。
- 草稿防抖自动保存，并在切换 Card、切换项目和关闭窗口前 flush；C# 始终由用户显式生成。
- 使用 sourceHash、generatorVersion 和 artifactHash 恢复生成同步状态，发现外部 C# 修改时阻止测试与无提示覆盖。
- 删除 Card 使用项目内回收站和补偿机制；批量生成逐 Card 尽力完成；启动游戏前执行产物预检。
- AI 返回完整 Card 提案，先预览，确认后作为一个可撤销事务应用；基线 revision 变化后提案过期且不可应用。
- 内部小提交持续可运行，完整链路就绪后用户侧一次切换，不保留长期双轨或功能开关。

## Commits

1. `docs: lock v0.9 card editor decisions and rollout plan` — 锁定领域词汇、ADR 和实施顺序。
2. `refactor(kinds): enforce the v0.9 card registry boundary` — 增加固定 receiver，收紧已注册 kind 与版本范围。
3. `refactor(card): make the existing CardData the sole canonical model` — 给现有权威模型加入 Card ID，消除 Card 级 target。
4. `feat(card): define the versioned CardDocument envelope` — 定义聚合文档及可编辑、迁移、只读和损坏解析结果。
5. `feat(card): add pure sequential CardDocument migrations` — 建立逐版本纯函数迁移链。
6. `refactor(graph): separate structural validation from card semantics` — 分离结构安全与生成完整性校验。
7. `feat(card): validate unique trigger roots and linear effect chains` — 落地 Card 的生成语义规则。
8. `feat(graph): prevent invalid card connections at edit time` — 在交互阶段提前拒绝非法链路。
9. `feat(files): expose atomic file primitives through Electron` — 提供原子替换、移动、删除和存在性能力。
10. `feat(card): add a filesystem-backed CardDocument repository` — 只从 `.modstudio/cards/` 读取并原子保存。
11. `feat(card): back up and persist known schema migrations` — 迁移写回前备份，失败时只读隔离单 Card。
12. `feat(card): isolate C# parsing behind explicit legacy import` — 停止正常反向解析，建立一次性迁移入口。
13. `refactor(card-store): select and mutate cards by immutable ID` — Store 改为 ID 身份并移除 Card localStorage 权威数据。
14. `feat(project): load CardDocuments when a project opens` — 项目打开和切换接入 repository 与逐 Card 隔离。
15. `feat(card): require ID confirmation before first persistence` — 首次落盘前确认 ID，之后锁定。
16. `refactor(history): extract generic immutable snapshot history` — 提取可供 Card 使用的泛型历史核心。
17. `feat(card-history): add Card-level edit transactions` — 表单与图共享历史并实现输入事务合并。
18. `feat(canvas): coalesce one node drag into one Card transaction` — 一次拖动只形成一步历史。
19. `feat(card-editor): integrate NodeGraph into the existing editor` — 原位接入画布、palette、历史和折叠预览。
20. `feat(card): autosave drafts and flush lifecycle boundaries` — 草稿自动保存及切换/关闭前 flush。
21. `refactor(codegen): share deterministic linear-chain traversal` — 共享确定性链遍历并从 registry 读取方法语义。
22. `feat(card): generate C# from the canonical CardDocument` — 只从已校验权威文档生成。
23. `feat(card): compute semantic and generator fingerprints` — 实现语义哈希与生成器版本。
24. `feat(card): atomically write and verify generated artifacts` — 原子写 C#、读回并记录产物哈希。
25. `feat(card): protect externally modified C# artifacts` — 阻止静默覆盖外部修改。
26. `feat(card): move deleted cards to project trash atomically` — 文档与产物一并暂存，失败补偿恢复。
27. `feat(card): restore cards from trash with ID conflict checks` — 支持回收站恢复和大小写无关冲突检查。
28. `feat(card): add best-effort batch generation reports` — 逐 Card 生成并汇总成功、跳过和失败。
29. `feat(test): gate game launch with artifact preflight` — 根据实际加载产物状态决定是否允许启动。
30. `feat(ai): request and validate complete Card proposals` — AI 输出完整草稿并先形成预览提案。
31. `feat(ai): apply revision-bound proposals as one transaction` — 提案绑定 revision，确认应用为一个撤销事务。
32. `refactor(card): remove superseded dual paths` — 删除已被吸收的第二模型、编辑器和重复 codegen。
33. `test(card): exercise the v0.9 release gate end to end` — 补齐真实目录端到端和 Electron smoke 验收。

每个提交必须带对应测试并保持测试、TypeScript 检查和 Renderer/Electron 构建通过。阶段 C 是架构闸门：正常加载路径若仍 import 或调用 C# parser，不得继续接入 UI。

## Decision Document

已接受的核心决定：

- 原位升级现有 CardEditor，不创建“节点版 Card”。
- Card Document 是 Card 属性和行为图的保存、迁移原子边界。
- `.modstudio` 是权威数据源，`scripts` 是生成产物。
- Card 草稿可保存，生成必须通过完整语义校验。
- 表单和图使用统一 Card 历史。
- 生成状态由 sourceHash、generatorVersion 和 artifactHash 共同恢复。
- 未知 kind 或未来 schema 使用逐 Card 保真只读恢复。
- v0.9 只交付 Card 端到端，Relic Any/EventTarget 延后到 v0.10。

## Testing Decisions

- 单元测试覆盖 Card ID、Card Document、迁移、图结构、生成语义、历史事务、哈希和状态矩阵。
- 组件测试覆盖原位编辑器、创建 ID、只读恢复、迁移报告、回收站、批量报告、测试预检和 AI 提案。
- 使用独立临时项目目录完成真实文件集成测试，不只 mock FileService。
- Electron smoke 覆盖窗口关闭前 flush、项目切换、生成、外部修改、删除/恢复和启动预检。
- 发布门禁要求完整测试、TypeScript、Renderer/Electron 构建全绿。
- 真实 LLM、真实游戏内行为和三平台安装包不作为 v0.9 阻塞项。

当前基线：323 项测试、TypeScript `--noEmit` 检查及 Renderer/Electron Vite 构建均通过。

## Out of Scope

- Relic Any trigger 与 EventTarget effect。
- condition、branch、循环或共享动作组节点。
- 从生成 C# 持续同步或反向合并编辑。
- AI 提案的逐字段/逐节点采纳和自动三方合并。
- Steam Workshop 发布流程。
- 真实 LLM provider、真实游戏行为和三平台安装包的全量验证。

## Further Notes

工作区存在未提交的 Card 节点试作，其中包含第二份 CardData、平行 CardEditor、重复 codegen/template 和与最终决定冲突的 Card 级 target。实施时不整包提交或直接丢弃：可复用部分逐项迁入权威路径，测试证明已吸收后再删除平行文件。

完成定义：正常项目只从 `.modstudio/cards/` 恢复 Card；旧 C# 导入必须显式启动；仓库只剩一份权威 CardData 和一个 CardEditor 入口；属性与图可以自动保存、重启恢复、统一撤销和显式生成；数据安全门禁与 AI revision 语义全部通过。
