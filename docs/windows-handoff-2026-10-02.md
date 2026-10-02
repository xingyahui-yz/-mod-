# Mod Studio Windows 交接文档

> 更新日期：2026-10-02。用途：把当前项目和已确认的产品约束交给 Windows 环境继续开发。本文记录当前决策，不代表 Windows 实机、STS2 Mod 编译或游戏加载已经验收。

## 交接入口

- GitHub 仓库：<https://github.com/xingyahui-yz/-mod->
- 当前工作分支：`codex/v0.10-history-governance`
- 当前分支跟踪的远端：`github/codex/v0.10-history-governance`
- 克隆后先检出此分支，再确认工作树和提交记录；不要把本交接直接合并到默认分支，除非另行决定。
- 老文档 [handoff-2026-08-03.md](./handoff-2026-08-03.md) 是 v0.3 节点编辑器时期的历史交接，已过时；项目当前领域模型与路线以根目录 [CONTEXT.md](../CONTEXT.md)、[ADR-0008](./adr/0008-card-build-and-playtest.md) 和本文为准。

## 产品目标和持续约束

1. **产品主线是创作 Slay the Spire 2 Mod。** Mod Studio 是本地桌面创作工具，目标用户懂文件夹和 API Key，但不需要手写 C# 或 Godot。路线规划覆盖 Card、Character、Relic、Potion、Event、Enemy、Buff/Debuff、UI/视觉等实体；当前实现并不等于八类实体都已完成。
2. **本地优先。** Mod 项目根目录包含 `mod_manifest.json`；`.modstudio/` 保存可恢复的项目源数据，生成的代码和可发布产物是派生内容。Card 的属性和行为图必须保持同一份 `CardDocument`，Card ID 创建后不可变；新增功能应沿用现有保存、历史、迁移和生成安全边界。
3. **开发优先级已确认。** 先解决 Card 的真实游戏构建与验证闭环；AI 卡面、打击音效、人物动作生成后续再做。之前的媒体可行性研究是技术建议，不是已经授权或实现的当前开发目标。
4. **当前已实现的 Card 能力**包括表单与行为图编辑、自动保存、显式 C# 生成、语义/同步预检、批量生成、项目级 AI 对话与逐 Card 提案审阅。Mod Manager 管理的是游戏目录中已安装的 Mod，和 Mod Studio 的创作项目列表不是同一概念。
5. **Workshop 发布是后续能力。** 本轮同步设计，但先完成本地实机闭环。发布工作区必须剥离 `.modstudio/`；调用官方上传器和提交上传是用户确认后的独立动作，不能由启动游戏或本地部署隐式触发。
6. **不承诺零基础。** 用户仍需能选择项目目录、配置 API Key、查看清楚的环境诊断并按指引安装受信任的依赖。Mod Studio 不应静默下载或安装系统级构建环境。

## 已确认的第一阶段验收

### 阶段 A：游戏版本和生成器兼容性验证

在 Windows 上优先验证用户实际安装的 STS2 版本；样例为一张普通、固定伤害的 Ironclad 攻击牌：

- Card 被放入 Ironclad 的普通卡池，在正常对局可获得；不以只启动游戏或只编译 DLL 作为通过。
- 不要求自定义卡面，先聚焦规则和伤害行为。
- 确认代码生成、完整 Mod 构建、部署到本机游戏 Mod 目录、游戏加载、卡池出现以及造成预期伤害。
- 本地模板目前使用 `RitsuMod.Content.CardComponent`；第一步应在真实安装版本上试编译和运行，再决定保留或迁移生成器/框架，不要先假设 `RitsuMod`、RitsuLib 或其他社区框架对所有游戏版本兼容。
- 探测当前游戏版本并显示验证状态。未验证版本可以继续尝试，但必须明确警告并记录构建、部署、实机验证三种不同结果。
- 缺少 .NET、Godot/MegaDot、游戏程序集或 Mod 模板依赖时，提供可信来源和清晰指引；不自动安装。

### 阶段 B：可复用的 Card 构建/部署/测试流程

兼容性验证成功后，把试验步骤沉淀成可用于普通 Card 创作的流程。保持 Mod 项目源数据与本地部署副本分离；让失败可诊断和重试；不要把“代码生成成功”“Mod 构建成功”“本地部署成功”“游戏启动成功”和“实机验证通过”混为一个状态。

### 阶段 C：Workshop 发布实现（设计并行，实施在本地闭环后）

- 目标是应用内准备发布工作区、调用 Mega Crit 的官方 STS2 Mod Uploader。
- 构建和发布包预检必须通过；实机测试作为强提醒，不作为上传硬门槛。
- 用户在实际上传前必须单独确认；首次发布与更新现有 Workshop 条目应区分处理。
- `.modstudio/`、生成候选和工具内部数据不得进入用户 Mod 的发布内容。发布包内容应来自当前成功构建的结果。
- 官方上传器和游戏的内置 Mod 加载器是外部接口，先按仓库已有研究验证当前版本，不把过去上传器/manifest 格式当作永不变化的契约。

### 后续媒体路线

AI 媒体生成目前延期。既有建议顺序是先卡面插画，再短打击音效，最后角色关键姿势/短序列帧；完整自动骨骼动画不应作为首版承诺。媒体供应商、费用、二进制存储和游戏资源绑定详见 [AI 媒体可行性方案](./ai-media-feasibility-2026-09-26.md) 与 [供应商研究](./ai-media-provider-research-2026-09-26.md)。这些资料中的预测、候选供应商、时长和结构建议需要在重新立项时复核。

## Windows 环境恢复与验证

1. 克隆 `https://github.com/xingyahui-yz/-mod-.git`，检出 `codex/v0.10-history-governance`，确认 Git 状态后再开始工作。
2. 安装受支持的 Node.js LTS 和 npm；使用仓库的 `package-lock.json` 执行 `npm ci`。
3. 先跑仓库现有门禁：`npm test`、`npx tsc -p tsconfig.node.json --noEmit`、`npx tsc --noEmit`，然后 `npm run build`。Windows 上的 Electron 安装和打包需要在 Windows 主机本身验证。
4. 启动 Mod Studio 后，在设置里指定本机 STS2 安装目录，确认应用找到实际 `Slay the Spire 2.exe`，再进行游戏启动 smoke。
5. **区分两种构建：** `npm run build` 构建的是 Mod Studio 桌面应用，不会编译 Card 或制作 STS2 Mod。当前游戏测试预检只检查 Card C# 产物，`game:launch` 主要负责启动游戏；`modPath` 当前未用于编译、打包或部署。实际 Mod 构建、Ironclad 卡池注册和本地部署仍是第一阶段工作。
6. 真实游戏兼容性取决于目标机器实际安装的 STS2 版本及其配套的 .NET / Godot 引擎、游戏程序集和 Mod 框架。先从游戏安装与可信 Modding 模板资料确定版本，不在交接文档里钉死一个 SDK 版本。
7. `electron/main.ts` 当前显式寻找 Windows 的几个 `.exe` 名称并支持 Windows / macOS 分支；Linux 游戏启动目前不支持。首轮 Windows 验收可用现有 Windows 分支，但仍应验证 Steam 安装目录和权限处理。

## 当前技术状态与限制

- 技术栈：Electron + React + TypeScript + Vite + Zustand；测试用 Vitest / Testing Library。
- Card 生成模板：`src/card/card.mustache`。Card 模型在 `src/types/index.ts`，尚没有角色/卡池归属字段。
- 项目脚手架：`src/components/NewProjectModal.tsx` 生成基础文件；尚未提供经当前 STS2 版本验证的完整 C# Mod 工程/构建配置。
- 游戏启动和预检：`src/components/GameLauncher.tsx` 先调用 Card 产物预检再启动；这只能证明检查和启动动作发生，不能证明 Mod 已加载或 Card 进入牌池。
- 已安装 Mod 管理器位于 `src/mod-manager/` 和 `electron/modManager.ts`：扫描游戏 `mods/` 的直接子目录；安装本地已构建目录（根部需有可识别的 JSON 清单及 `.dll`/`.pck`）；通过搬移目录启用/停用；卸载移入 `.modstudio-removed-mods` 回收目录。暂不负责依赖解析、冲突/加载顺序、在线下载、构建或 Workshop 上传。
- 文档记录的自动化测试数量目前不一致：README 写 745 项，CONTEXT 记录 733 项。不要把这两个旧数字当成 Windows 的验收结果；在目标分支上运行 `npm test` 并更新准确结果。当前分支仍待 Electron 手工 smoke。

## 开始开发前的次序

1. 先确认 Windows clone/checkout、依赖安装、单测、TypeScript 和桌面应用构建结果。
2. 保存一次 Windows 实机 smoke 结果（应用启动、游戏路径检测、游戏启动）。
3. 再做 Card Mod 兼容性验证，先证明一张 Ironclad 普通攻击牌可构建、部署、正常对局出现并打出；如模板或框架不兼容，记录实际错误与版本后再选迁移路径。
4. 兼容性通过后制定可复用的游戏版本/工具链检测、构建、部署、回滚和错误报告方案；随后进入通用 Card 流程。
5. 保持 Workshop 发布工作区和上传确认的设计同步更新；只有本地闭环完成后才实现上传。
6. Card 游戏闭环未验收前，不要把 AI 媒体生成或其它实体编辑扩展为新的主线。

## 参考资料

- [领域模型与术语](../CONTEXT.md)
- [Card 构建与实机验证 ADR](./adr/0008-card-build-and-playtest.md)
- [本地项目结构 ADR（`.modstudio/` 与发布剥离约定）](./adr/0003-local-project-structure.md)
- [AI 媒体可行性与初步方案](./ai-media-feasibility-2026-09-26.md)
- [AI 媒体供应商研究](./ai-media-provider-research-2026-09-26.md)
- [Mega Crit 官方 Workshop 上传器](https://github.com/megacrit/sts2-mod-uploader)
- [Slay the Spire 2 官方 Mod 支持公告](https://steamcommunity.com/app/2868840/announcements/)
