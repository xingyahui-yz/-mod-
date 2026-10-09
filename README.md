# Slay the Spire 2 Mod Studio

一款面向《杀戮尖塔 2》（STS2，Godot 4 + C# + RitsuLib）的桌面创作与 Mod 管理工具，覆盖卡牌编辑、遗物代码预览、项目级 AI 协作和已安装 Mod 管理。

> 当前版本为 **v0.10**。Card 端到端安全闭环、项目级 AI 多轮对话、Mod 管理器和多服务商配置已接入；v0.10 自动门禁已通过，Electron 手工 smoke 仍待完成。

## 功能特性

### 编辑能力

- **Card 端到端编辑器** — 基础属性与行为图使用同一份 Card 文档；草稿自动保存，C# 由用户显式生成
- **逐 Card 撤销/重做** — 每张 Card 独立历史；连续文本输入与节点拖动按编辑事务合并
- **生成安全** — schema 迁移、只读隔离、语义校验、生成指纹、外部修改保护、批量生成报告与测试预检
- **Relic（遗物）编辑器** — 填写资料、编排触发器与效果节点、撤销/重做并预览生成的 C#；内置 5 步交互教程。当前版本不将遗物保存到项目，生成代码需复制到 Mod 项目中
- **可视化节点编辑器** — SVG 画布 + 贝塞尔边 + 端口 click-to-connect；纯函数数据层（`buildNode` / `addNodeToGraph` / `touchGraph` / `getPortXY`）
- **Mod 管理器** — 扫描游戏目录中的 Mod，支持搜索、安装已构建的 Mod 包、启用/停用、打开 Mods 目录和安全卸载到回收区

### 架构亮点

- **CardCatalog 深模块** — `CardDocument` 是 Card 内存状态的唯一权威；列表、当前 Card、索引及历史能力均由 selector 派生
- **Card 生命周期分层** — 文档仓库、回收站、生成、产物安全和测试预检保持独立领域边界
- **Relic 模块化** — `src/shared/kinds.ts` 是跨实体 trigger/effect 种类的单一真相源；遗物编辑器按当前支持范围提供图形编排和 C# 预览
- **8 类实体通用语言** — 领域词汇和当前进度见 [CONTEXT.md](./CONTEXT.md)，架构决策见 7 份 [ADR](./docs/adr/)
- **服务商适配层** — 67 个内置服务商预设，覆盖 OpenAI 兼容、OpenAI Responses、Anthropic Messages、Gemini 和 Ollama 协议；支持自定义网关与本地模型

### 工具与体验

- **项目级 AI Card 对话** — 多轮历史、快捷回答、显式 Card 附件与多 Card 提案均绑定当前项目；提案可逐张预览、接受、拒绝，并与 Card 撤销/重做联动
- **逐 Card 提案确认** — 创建/修改分别预览，接受时才写入项目；支持独立过期、不可恢复拒绝及 undo/redo 来源追踪
- **AI 服务商与密钥设置** — 管理多服务商、多 API Key 和模型；支持获取或手动添加模型、连接检测、自定义服务商及高级请求参数
- **交互教程** — 启动时提供 8 步新手引导；遗物编辑器另有 5 步专属教程
- **任务系统** — 完整的任务引导，从创建到测试
- **一键测试** — 自动启动游戏加载你的 Mod
- **主题切换** — 支持暗/亮主题
- **错误边界** — 友好的错误处理
- **本地项目源数据** — `.modstudio/cards/` 保存权威 Card 文档，`scripts/Cards/` 只保存可重新生成的 C# 产物
- **自动化验证** — 当前完整测试套件 **745 项**（2026-09-25 全部通过），另有 TypeScript、Vite 和 Electron 构建门禁

### UI 图标

- 应用界面使用 `src/components/Icon.tsx` 中的 React SVG 图标，不使用 emoji 字符作为图标。
- 通用图标由项目内 SVG 图标集绘制维护；`zmd-charge-plus` 仅作为视觉风格参考，来源说明见 `THIRD-PARTY-NOTICES.md`。
- 卡牌类型筛选使用专属 `cardAttack`、`cardSkill` 和 `cardPower` 图标；名称与卡牌类型在 `CARD_TYPES` 中统一维护。

## 技术栈

- **桌面框架**: Electron 28
- **前端**: React 18 + TypeScript
- **状态管理**: Zustand (with persist)
- **模板引擎**: Mustache
- **测试**: Vitest + jsdom
- **构建**: Vite 5 + electron-builder

## 项目结构

```
mod-studio/
├── electron/                     # Electron 主进程
│   ├── main.ts                   # 窗口、IPC 处理
│   ├── modManager.ts              # 安装、启停、扫描与卸载 Mod
│   └── preload.ts                # 安全 API 暴露
├── src/
│   ├── components/               # 通用 UI 组件
│   │   ├── CardEditor.tsx        # 卡牌编辑器
│   │   ├── Icon.tsx              # 统一 SVG 图标
│   │   ├── GameLauncher.tsx      # 游戏启动
│   │   ├── SettingsModal.tsx      # 服务商、API Key、模型与游戏路径设置
│   │   └── Modal.tsx / Toast.tsx / Tutorial.tsx / ...
│   ├── ai-conversation/          # 项目对话、提案生命周期、持久化与右侧抽屉
│   ├── mod-manager/              # 已安装 Mod 管理界面
│   ├── node-editor/              # 自研可视化节点编辑器
│   │   ├── graph.ts              # 纯函数数据层（appendNode / connect / hasCycle / ...）
│   │   ├── types.ts              # NodeGraph / Node / Edge / Port 类型
│   │   ├── useNodeGraph.ts       # React state wrapper
│   │   ├── NodeGraphCanvas.tsx   # SVG 画布 + 端口坐标走 getPortXY
│   │   └── graph.test.ts / node-editor.test.tsx
│   ├── relic/                    # Relic 编辑器、教程与代码生成
│   │   ├── codegen.ts            # generateRelicCode / collectStatements 纯函数
│   │   ├── RelicData.ts          # 类型 + 表单 schema（5 字段）
│   │   ├── RelicEditor.tsx       # 表单 + 节点图 + C# 预览
│   │   ├── RelicTutorial.tsx     # 5 步遗物编辑教程
│   │   ├── relic.mustache        # C# 模板
│   │   └── *.test.*              # 遗物种类、代码生成与编辑器测试
│   ├── shared/kinds.ts           # trigger/effect 种类定义与中文显示名
│   ├── card/                     # CardDocument / CardCatalog / 校验 / 生成 / 仓库 / 回收站
│   ├── types/index.ts            # 全局类型入口
│   ├── stores/                   # AI、任务等 UI 状态
│   ├── services/                 # FileService + llm/providerCatalog、设置与协议适配器
│   ├── utils/                    # cardUtils / cardParser / codeGenerator / stringUtils / theme
│   ├── templates/                # card.mustache
│   ├── hooks/                    # useProject / useTransientMessage
│   ├── integration/              # 端到端集成测试
│   ├── App.tsx                   # 主应用
│   └── main.tsx                  # 入口
├── docs/
│   ├── adr/                      # ADR-0001 至 ADR-0007
│   ├── diagrams/                 # Archify 架构、工作流、时序与生命周期图
│   └── v0.10-project-card-ai-conversation-implementation-plan.md
├── CONTEXT.md                    # 领域模型、通用语言、架构索引与项目进度
├── vitest.config.ts              # Vitest + jsdom
└── package.json
```

## 项目流程图

以下中文图表均为 Archify 生成的独立交互式 HTML，支持明暗主题、搜索、缩放、关系追踪和导出。GitHub 页面不能直接运行仓库内 HTML 时，请下载后用浏览器打开；同目录保留 JSON 规格与验证收据。

| 图表 | 类型 | 说明 |
|---|---|---|
| [Mod Studio 项目架构](./docs/diagrams/project-architecture.architecture.html) | Architecture | 多协议 Provider 配置、React 编辑器、Card 领域服务、Electron Mod 管理、项目数据与游戏边界 |
| [Card 编辑、保存与生成流程](./docs/diagrams/card-edit-generation.workflow.html) | Workflow | 编辑事务、防抖草稿保存、显式生成、覆盖保护、读回校验与指纹回写 |
| [项目打开与 Card 恢复流程](./docs/diagrams/project-open-recovery.workflow.html) | Workflow | 切换前等待 AI 事务并 flush 草稿、CardDocument 扫描、版本迁移与只读隔离 |
| [项目级 AI 对话单轮时序](./docs/diagrams/ai-conversation-turn.sequence.html) | Sequence | 发送前持久化、可选一次 Card 上下文补取、最终校验与原子提交后展示 |
| [AI Card 提案生命周期](./docs/diagrams/ai-proposal-lifecycle.lifecycle.html) | Lifecycle | revision 过期、WAL 与 Card 事务、拒绝/取代，以及 undo / redo 状态回转 |
| [AI 对话存储与归档生命周期](./docs/diagrams/conversation-governance.lifecycle.html) | Lifecycle | 软/硬容量门槛、旧 schema 迁移、原子归档、损坏恢复与未来版本隔离 |
| [AI 媒体创作与 Mod 导出目标流程（方案）](./docs/diagrams/ai-media-generation-proposal.workflow.html) | Workflow | 标出未来媒体生成、素材确认、引用绑定、Mod 导出和游戏内验证目标（尚未实现） |

可编辑规格位于 [`docs/diagrams/`](./docs/diagrams/)，所有规格均通过 Archify showcase 质量验证。

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建（tsc + vite + electron-builder）
npm run build

# 运行完整测试套件
npm test

# 监听模式运行测试
npm run test:watch
```

首次安装 Electron 较慢时，可按所在网络环境配置 Electron 下载镜像后再运行 `npm install`。

## 使用说明

### 1. 创建项目
点击「新建项目」按钮，填写项目名称、Mod ID、作者等信息。

### 2. 编辑 Card

切换到 Card 编辑器并创建 Card。基础属性和行为图会自动保存为项目源文档；完成语义校验后，使用“生成”显式更新 C#。撤销/重做只影响当前 Card，切换 Card 不会丢失各自历史。

### 3. 编辑 Relic
切换到「Relic 编辑器」标签：
1. 点「教程」可按步骤了解资料、触发器、效果、节点连线和代码生成。
2. 填写资料：ID、显示名、描述、Tier（遗物分级）和 Rarity（掉落稀有度）。
3. 添加 trigger（触发时机）与 effect（执行效果）节点，连接端口并调整流程；节点种类按钮同时显示中文说明。
4. 点击「生成代码」查看 C# 预览。当前编辑器不负责把遗物写入项目；复制生成代码并按自己的 Mod 项目结构保存。

### 4. AI Card 提案

打开项目后，从右侧对话抽屉输入自然语言要求。一轮可以只返回文字，也可以生成多张相互独立的 Card 创建/修改提案：

1. 修改现有 Card 时，打开提案会定位目标 Card，并按属性、节点和连线展示“当前内容 ↔ 提案内容”。
2. 创建新 Card 时，接受前只显示只读预览，不加入项目也不占用 ID；接受时确认最终 ID。
3. 每张 Card 独立接受或经二次确认后永久拒绝。修改提案遇到新 revision 会单独过期，不阻塞同轮其他 Card。
4. 接受修改作为一个 Card 历史事务；撤销后提案标记为 `reverted`，重做后恢复 `accepted`。接受提案不会自动生成 C#。
5. 提案接受、撤销和重做使用可恢复的跨文件事务日志；异常退出后只续做尚未确认的最后一步，不会覆盖用户后续编辑或复活已删除 Card。

多轮历史、取消/重试、快捷回答、显式 Card 附件、token 预算、一次自动上下文补取、混合摘要和版本化 JSON 恢复均已接通。对话达到 10 MB 或 5,000 条消息时提示归档；达到 50 MB 或 20,000 条消息硬限制时，当前轮完成后需先归档并重置才能继续。归档管理中的“存储性能与 SQLite 评估数据”展示当前项目会话实例最近 100 次活动文档仓储样本。p95 是常规活动文档仓储端到端耗时（含排队、解析/校验，不含归档重置），不是纯磁盘 I/O；软阈值规模样本单独统计。遥测只保存在内存、不包含对话文本，并显示本会话被硬限制拦截的发送/重试次数；软阈值规模下加载或保存 p95 超过 500 ms，或硬限制拦截频繁时，应立项评估 SQLite。详见 [ADR-0007](./docs/adr/0007-project-card-ai-conversation.md)。

### 5. 测试游戏
切换到「游戏测试」标签，设置游戏路径，点击启动游戏测试。

### 6. 管理已安装 Mod
在「设置与 API Key」中配置游戏安装目录后，打开「Mod 管理器」。可搜索、刷新和打开 Mods 目录；安装时选择已构建的 Mod 文件夹（根目录需包含清单和 `.dll` 或 `.pck`），也可启用或停用 Mod。卸载会将文件移入游戏目录下的 `.modstudio-removed-mods`，不会立即删除。

## AI 模型配置

1. 打开「设置与 API Key」，在「模型服务」中搜索并选择服务商。
2. 填写 API 地址（如需自定义）、添加一个或多个 API Key，并选择可用模型。已启用的多个密钥按列表顺序轮换。
3. 可通过「获取模型列表」发现模型，也可以手动添加模型 ID；先「检测连接」，再保存设置。
4. 在当前项目右侧 AI 抽屉开始对话。服务商与密钥保存在 Mod Studio 的本机 AI 设置中；项目对话历史单独保存在项目文档内。

内置目录包含 67 个服务商预设，例如 MiniMax、通义千问/百炼、文心一言、智谱、DeepSeek、OpenAI、Anthropic、Gemini、Moonshot、SiliconFlow、OpenRouter、Ollama、LM Studio 等；也可添加自定义服务商。支持 OpenAI 兼容 Chat Completions、OpenAI Responses、Anthropic Messages、Gemini 和 Ollama 协议，并提供请求路径、密钥传递方式、请求头/查询参数/请求体及采样参数设置。目录里部分 OAuth/CLI 或需要专用云端鉴权的项目不能直接通过通用 API Key 模式连接，详情以设置页中该预设的说明为准。

## 路线图

| 版本 | 状态 | 内容 |
|---|---|---|
| v0.1-v0.8 | 已完成 | 节点编辑器、Relic 模块、项目文件服务、AI 结构化输出与架构加深 |
| v0.9 | 已完成 | Card 单一文档模型、行为图、自动保存、显式生成、迁移/恢复、回收站、批量生成、测试预检与 Electron release gate |
| CardCatalog | 已完成 | Card 文档唯一权威、逐 Card 历史、文本/拖动事务合并与 revision-safe AI/生成操作 |
| **v0.10** | 发布收口 | 四个切片的功能已完成；2026-09-25 完整测试（57 个测试文件、745 项）与 TypeScript/Vite/Electron 构建通过，仍需 Electron 手工 smoke 后关闭发布门禁 |
| 后续 | 计划 | Relic 接入 Card 同等级项目生命周期，再扩展 Character / Potion / Event / Enemy / Buff / UI |
| v1.0+ | 计划 | Steam Workshop 发布流程 |

详细架构决策见 [CONTEXT.md](./CONTEXT.md) 与 [docs/adr/](./docs/adr/)；v0.10 的分支、提交序列和验收门槛见 [实施计划](./docs/v0.10-project-card-ai-conversation-implementation-plan.md)。

## 贡献

建议使用短生命周期功能分支：

```bash
git checkout -b feature/<name>
# 小步提交，并在提交前运行测试与构建
git checkout main
git merge --no-ff feature/<name>
git push origin main
```

提交前请只暂存本次变更，并保留现有用户工作区中的无关修改。

## 学习资源

- [STS2 Wiki](https://sts2.wiki/)
- [RitsuLib](https://github.com/BAKAOLC/STS2-RitsuLib)
- [ModTemplate-StS2](https://github.com/CKRainbow/ModTemplate-StS2)
- [CONTEXT.md（领域模型 + 通用语言 + ADR 索引）](./CONTEXT.md)

## License

MIT
