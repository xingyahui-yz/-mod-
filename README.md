# Slay the Spire 2 Mod Studio

一款面向《杀戮尖塔 2》（STS2，Godot 4 + C# + RitsuLib）的桌面 Mod 开发工具。

> 当前开发主线已贯通 **Card 端到端安全闭环**与项目级 AI 多轮对话；对话可一轮产生多张 Card 提案，由用户逐张预览和确认。

## ✨ 功能特性

### 编辑能力

- 🃏 **Card 端到端编辑器** — 基础属性与行为图使用同一份 Card 文档；草稿自动保存，C# 由用户显式生成
- ↩️ **逐 Card 撤销/重做** — 每张 Card 独立历史；连续文本输入与节点拖动按编辑事务合并
- 🛡️ **生成安全** — schema 迁移、只读隔离、语义校验、生成指纹、外部修改保护、批量生成报告与测试预检
- 🔮 **Relic（遗物）编辑器** — v0.4 端到端：表单 + 可视化节点图 + C# 模板代码生成
- 🧩 **可视化节点编辑器** — SVG 画布 + 贝塞尔边 + 端口 click-to-connect；纯函数数据层（`buildNode` / `addNodeToGraph` / `touchGraph` / `getPortXY`）

### 架构亮点

- **CardCatalog 深模块** — `CardDocument` 是 Card 内存状态的唯一权威；列表、当前 Card、索引及历史能力均由 selector 派生
- **Card 生命周期分层** — 文档仓库、回收站、生成、产物安全和测试预检保持独立领域边界
- **Relic 模块化** — `src/relic/` 内的 kind registry 是 trigger/effect 的单一真相源
- **8 类实体通用语言** — 领域词汇和当前进度见 [CONTEXT.md](./CONTEXT.md)，架构决策见 7 份 [ADR](./docs/adr/)

### 工具与体验

- 🤖 **项目级 AI Card 对话** — 支持 MiniMax、通义千问、文心一言、ChatGLM；多轮历史、快捷回答、显式 Card 附件与多 Card 提案均绑定当前项目
- ✅ **逐 Card 提案确认** — 创建/修改分别预览，接受时才写入项目；支持独立过期、不可恢复拒绝及 undo/redo 来源追踪
- 📚 **新手教程** — 8 步交互式教程，零基础也能上手
- 📋 **任务系统** — 完整的任务引导，从创建到测试
- 🚀 **一键测试** — 自动启动游戏加载你的 Mod
- 🎨 **主题切换** — 支持暗/亮主题
- 🛡️ **错误边界** — 友好的错误处理
- 💾 **本地项目源数据** — `.modstudio/cards/` 保存权威 Card 文档，`scripts/Cards/` 只保存可重新生成的 C# 产物
- ✅ **自动化验证** — 当前完整测试套件 **617 项**，另有 Renderer/Electron 两套 TypeScript 检查与 Electron 完整构建门禁

## 🛠️ 技术栈

- **桌面框架**: Electron 28
- **前端**: React 18 + TypeScript
- **状态管理**: Zustand (with persist)
- **模板引擎**: Mustache
- **测试**: Vitest + jsdom
- **构建**: Vite 5 + electron-builder

## 📁 项目结构

```
mod-studio/
├── electron/                     # Electron 主进程
│   ├── main.ts                   # 窗口、IPC 处理
│   └── preload.ts                # 安全 API 暴露
├── src/
│   ├── components/               # 通用 UI 组件
│   │   ├── CardEditor.tsx        # 卡牌编辑器
│   │   ├── GameLauncher.tsx      # 游戏启动
│   │   ├── Modal.tsx / Toast.tsx / Tutorial.tsx / ...
│   ├── ai-conversation/          # 项目对话、提案生命周期、持久化与右侧抽屉
│   ├── node-editor/              # 自研可视化节点编辑器
│   │   ├── graph.ts              # 纯函数数据层（appendNode / connect / hasCycle / ...）
│   │   ├── types.ts              # NodeGraph / Node / Edge / Port 类型
│   │   ├── useNodeGraph.ts       # React state wrapper
│   │   ├── NodeGraphCanvas.tsx   # SVG 画布 + 端口坐标走 getPortXY
│   │   └── graph.test.ts / node-editor.test.tsx
│   ├── relic/                    # Relic 实体模块
│   │   ├── kinds.ts              # 单一真相源：TRIGGER_KINDS + EFFECT_KINDS + SUPPORTED_*
│   │   ├── codegen.ts            # generateRelicCode / collectStatements 纯函数
│   │   ├── RelicData.ts          # 类型 + 表单 schema（5 字段）
│   │   ├── RelicEditor.tsx       # UI（表单 + 节点图 + 预览）
│   │   ├── relic.mustache        # C# 模板
│   │   └── kinds/codegen/RelicEditor .test.*
│   ├── card/                     # CardDocument / CardCatalog / 校验 / 生成 / 仓库 / 回收站
│   ├── types/index.ts            # 全局类型入口
│   ├── stores/                   # AI、任务等 UI 状态
│   ├── services/                 # FileService + llm/adapters/
│   ├── utils/                    # cardUtils / cardParser / codeGenerator / stringUtils / theme
│   ├── templates/                # card.mustache
│   ├── hooks/                    # useProject / useTransientMessage
│   ├── integration/              # 端到端集成测试
│   ├── App.tsx                   # 主应用
│   └── main.tsx                  # 入口
├── docs/
│   ├── adr/                      # ADR-0001 至 ADR-0007
│   ├── v0.9-card-node-editor-implementation-plan.md
│   └── v0.9-release-gate.md
├── CONTEXT.md                    # 领域模型、通用语言、架构索引与项目进度
├── vitest.config.ts              # Vitest + jsdom
└── package.json
```

## 🗺️ 项目流程图

以下中文图表均为 Archify 生成的独立交互式 HTML，支持明暗主题、搜索、缩放、关系追踪和导出。GitHub 页面不能直接运行仓库内 HTML 时，请下载后用浏览器打开；同目录保留 JSON 规格与验证收据。

| 图表 | 类型 | 说明 |
|---|---|---|
| [Mod Studio 项目架构](./docs/diagrams/project-architecture.architecture.html) | Architecture | React、CardCatalog、Card 领域服务、项目源数据、LLM 与游戏之间的模块关系 |
| [Card 编辑、保存与生成流程](./docs/diagrams/card-edit-generation.workflow.html) | Workflow | 编辑事务、草稿自动保存、显式生成、校验、产物写入与失败保护 |
| [项目打开与 Card 恢复流程](./docs/diagrams/project-open-recovery.workflow.html) | Workflow | 项目切换、CardDocument 扫描、迁移、只读隔离与目录装载 |
| [项目级 AI 对话单轮时序](./docs/diagrams/ai-conversation-turn.sequence.html) | Sequence | 发送前持久化、模型调用、响应校验、最终原子提交与可见时点 |
| [AI Card 提案生命周期](./docs/diagrams/ai-proposal-lifecycle.lifecycle.html) | Lifecycle | pending、accepted、reverted、stale、rejected 与 superseded 状态 |
| [AI 对话存储与归档生命周期](./docs/diagrams/conversation-governance.lifecycle.html) | Lifecycle | 首次创建、软/硬阈值、原子归档、隔离与 schema 迁移 |

可编辑规格位于 [`docs/diagrams/`](./docs/diagrams/)，所有规格均通过 Archify showcase 质量验证。

## 🚀 开发

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

## 📖 使用说明

### 1. 创建项目
点击「新建项目」按钮，填写项目名称、Mod ID、作者等信息。

### 2. 编辑 Card

切换到 Card 编辑器并创建 Card。基础属性和行为图会自动保存为项目源文档；完成语义校验后，使用“生成”显式更新 C#。撤销/重做只影响当前 Card，切换 Card 不会丢失各自历史。

### 3. 编辑 Relic（v0.4 + v0.5.x 节点图）
切换到「🔮 Relic 编辑器」标签：
1. 填写表单（5 字段：id / 名称 / tier / rarity / description）
2. 在节点画布上拼装 trigger → effect 链（拖端口连线）
3. 实时预览生成的 C# 代码
4. 保存到项目

### 4. AI Card 提案

打开项目后，从右侧对话抽屉输入自然语言要求。一轮可以只返回文字，也可以生成多张相互独立的 Card 创建/修改提案：

1. 修改现有 Card 时，打开提案会定位目标 Card，并按属性、节点和连线展示“当前内容 ↔ 提案内容”。
2. 创建新 Card 时，接受前只显示只读预览，不加入项目也不占用 ID；接受时确认最终 ID。
3. 每张 Card 独立接受或经二次确认后永久拒绝。修改提案遇到新 revision 会单独过期，不阻塞同轮其他 Card。
4. 接受修改作为一个 Card 历史事务；撤销后提案标记为 `reverted`，重做后恢复 `accepted`。接受提案不会自动生成 C#。
5. 提案接受、撤销和重做使用可恢复的跨文件事务日志；异常退出后只续做尚未确认的最后一步，不会覆盖用户后续编辑或复活已删除 Card。

多轮历史、取消/重试、快捷回答、显式 Card 附件和版本化 JSON 恢复已接通。归档管理中的“存储性能与 SQLite 评估数据”展示当前项目会话实例最近 100 次活动文档加载/原子保存样本；达到 10 MB 或 5,000 条消息的软阈值样本单独统计 p95。该遥测只保存在内存且不包含对话文本；软阈值规模下加载或保存 p95 超过 500 ms 时，应立项评估 SQLite。跨归档查询、局部/并发写入和频繁触达硬上限也是独立升级触发条件。后续切片将补齐 token 预算、一次自动补取与混合摘要。详见 [ADR-0007](./docs/adr/0007-project-card-ai-conversation.md)。

### 5. 测试游戏
切换到「🎮 游戏测试」标签，设置游戏路径，点击启动游戏测试。

## 🤖 AI 模型配置

1. 打开“设置”
2. 选择模型提供商并输入 API Key
3. 保存设置，在当前项目的右侧 AI 抽屉开始对话

各模型获取 API 密钥：
- MiniMax: https://www.minimax.chat/
- 通义千问: https://dashscope.console.aliyun.com/
- 文心一言: https://console.bce.baidu.com/
- ChatGLM: https://open.bigmodel.cn/

## 🗺️ 路线图

| 版本 | 状态 | 内容 |
|---|---|---|
| v0.1-v0.8 | ✅ 已完成 | 节点编辑器、Relic 模块、项目文件服务、AI 结构化输出与架构加深 |
| v0.9 | ✅ 已完成 | Card 单一文档模型、行为图、自动保存、显式生成、迁移/恢复、回收站、批量生成、测试预检与 Electron release gate |
| CardCatalog | ✅ 已完成 | Card 文档唯一权威、逐 Card 历史、文本/拖动事务合并与 revision-safe AI/生成操作 |
| **v0.10** | 🛠️ 实施中 | 对话骨架与 Card 提案已完成；上下文智能已接入目录/相关 Card 上下文、摘要与预算。历史治理切片已完成容量门禁、原子归档/只读浏览、隔离恢复及运行时 p95 指标，仍需最终 Electron 手工路径与全量发布门禁 |
| 后续 | 📋 计划 | Relic 接入 Card 同等级项目生命周期，再扩展 Character / Potion / Event / Enemy / Buff / UI |
| v1.0+ | 📋 计划 | Steam Workshop 发布流程 |

详细架构决策见 [CONTEXT.md](./CONTEXT.md) 与 [docs/adr/](./docs/adr/)；v0.10 的分支、提交序列和验收门槛见 [实施计划](./docs/v0.10-project-card-ai-conversation-implementation-plan.md)。

## 🤝 贡献

建议使用短生命周期功能分支：

```bash
git checkout -b feature/<name>
# 小步提交，并在提交前运行测试与构建
git checkout main
git merge --no-ff feature/<name>
git push origin main
```

提交前请只暂存本次变更，并保留现有用户工作区中的无关修改。

## 📚 学习资源

- [STS2 Wiki](https://sts2.wiki/)
- [RitsuLib](https://github.com/BAKAOLC/STS2-RitsuLib)
- [ModTemplate-StS2](https://github.com/CKRainbow/ModTemplate-StS2)
- [CONTEXT.md（领域模型 + 通用语言 + ADR 索引）](./CONTEXT.md)

## 📝 License

MIT
