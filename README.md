# Slay the Spire 2 Mod Studio

一款简洁的杀戮尖塔2 (STS2, Godot 4 + C#, RitsuLib 框架) Mod 开发工具。
> 内置**可视化节点编辑器** + **Relic 端到端编辑** + **多模型 AI 辅助生成** + **一键游戏测试**

## ✨ 功能特性

### 编辑能力

- 🃏 **卡牌编辑器** — 表单填写，实时预览，自动生成 C# 代码
- 🔮 **Relic（遗物）编辑器** — v0.4 端到端：表单 + 可视化节点图 + C# 模板代码生成
- 🧩 **可视化节点编辑器** — SVG 画布 + 贝塞尔边 + 端口 click-to-connect；纯函数数据层（`buildNode` / `addNodeToGraph` / `touchGraph` / `getPortXY`）

### 架构亮点

- **Relic 模块化**（v0.5.2）— `src/relic/` 单模块，`kinds.ts` 作**单一真相源**（trigger/effect 全 registry），codegen 与 RelicEditor 都从它读
- **8 类实体通用语言**（[CONTEXT.md](./CONTEXT.md) E1-E8）+ 4 个 ADR（自研节点编辑器 / AI JSON Schema / 本地项目结构 / 多 mod 模式）
- **多分支工作流**（v0.5.2 起）— `feature/<name>` 分支 → 中间多次 push → `git merge --no-ff` main

### 工具与体验

- 🤖 **AI 智能生成** — 支持 MiniMax、通义千问、文心一言、ChatGLM 等多模型
- 📚 **新手教程** — 8 步交互式教程，零基础也能上手
- 📋 **任务系统** — 完整的任务引导，从创建到测试
- 🚀 **一键测试** — 自动启动游戏加载你的 Mod
- 🎨 **主题切换** — 支持暗/亮主题
- 🛡️ **错误边界** — 友好的错误处理
- 💾 **数据持久化** — 配置、卡牌、Relic 数据自动保存
- ✅ **单元测试** — **240 个测试**覆盖核心逻辑（v0.5.2）

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
│   │   ├── AIGenerator.tsx       # AI 生成器
│   │   ├── GameLauncher.tsx      # 游戏启动
│   │   ├── Modal.tsx / Toast.tsx / Tutorial.tsx / ...
│   ├── node-editor/              # 🆕 自研可视化节点编辑器（v0.1-v0.5.1）
│   │   ├── graph.ts              # 纯函数数据层（appendNode / connect / hasCycle / ...）
│   │   ├── types.ts              # NodeGraph / Node / Edge / Port 类型
│   │   ├── useNodeGraph.ts       # React state wrapper
│   │   ├── NodeGraphCanvas.tsx   # SVG 画布 + 端口坐标走 getPortXY
│   │   └── graph.test.ts / node-editor.test.tsx
│   ├── relic/                    # 🆕 Relic 实体模块（v0.5.2 模块化）
│   │   ├── kinds.ts              # 单一真相源：TRIGGER_KINDS + EFFECT_KINDS + SUPPORTED_*
│   │   ├── codegen.ts            # generateRelicCode / collectStatements 纯函数
│   │   ├── RelicData.ts          # 类型 + 表单 schema（5 字段）
│   │   ├── RelicEditor.tsx       # UI（表单 + 节点图 + 预览）
│   │   ├── relic.mustache        # C# 模板
│   │   └── kinds/codegen/RelicEditor .test.*
│   ├── types/index.ts            # 全局类型入口
│   ├── stores/                   # Zustand：useCardStore / useProjectStore / useAIStore / useTaskStore
│   ├── services/                 # FileService + llm/adapters/
│   ├── utils/                    # cardUtils / cardParser / codeGenerator / stringUtils / theme
│   ├── templates/                # card.mustache
│   ├── hooks/                    # useProject / useTransientMessage
│   ├── integration/              # 端到端集成测试
│   ├── App.tsx                   # 主应用
│   └── main.tsx                  # 入口
├── docs/
│   ├── adr/                      # 🆕 架构决策记录
│   │   ├── 0001-node-editor-self-built.md
│   │   ├── 0002-ai-structured-output.md
│   │   ├── 0003-local-project-structure.md
│   │   └── 0004-multi-mod-mode.md
│   ├── handoff-2026-08-03.md
│   └── repo-analysis-2026-08-04.md
├── CONTEXT.md                    # 🆕 领域模型 + 通用语言 + 8 类实体（E1-E8）
├── vitest.config.ts              # jsdom 环境（⚠️ 见下方环境提示）
└── package.json
```

## 🚀 开发

```bash
# 安装依赖
npm install

# 开发模式（Electron + Vite，镜像走国内）
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dev

# 构建（tsc + vite + electron-builder）
npm run build

# 运行测试（240 个）
npm test

# 监听模式运行测试
npm run test:watch
```

> ⚠️ **环境提示（v0.5.3 候选）**：当前 `vitest` + `jsdom` 未列入 `devDependencies`，靠 `npx vitest` 临时下载 + 父目录 node_modules 解析。新人 clone 后需在父目录装 `jsdom`，或等 v0.5.3 修复。

## 📖 使用说明

### 1. 创建项目
点击「新建项目」按钮，填写项目名称、Mod ID、作者等信息。

### 2. 编辑卡牌（v0.4 端到端）
切换到「🃏 卡牌编辑器」标签，点击「新建卡牌」开始创建。表单填写 → 自动生成 C# 代码。

### 3. 编辑 Relic（v0.4 + v0.5.x 节点图）
切换到「🔮 Relic 编辑器」标签：
1. 填写表单（5 字段：id / 名称 / tier / rarity / description）
2. 在节点画布上拼装 trigger → effect 链（拖端口连线）
3. 实时预览生成的 C# 代码
4. 保存到项目

### 4. AI 智能生成
切换到「✨ AI 生成」标签，配置 API 密钥（支持 MiniMax、通义千问、文心一言、ChatGLM），输入自然语言描述，AI 会生成多个卡牌选项。

### 5. 测试游戏
切换到「🎮 游戏测试」标签，设置游戏路径，点击启动游戏测试。

## 🤖 AI 模型配置

1. 打开 AI 生成标签
2. 选择模型提供商
3. 输入 API 密钥
4. 开始生成卡牌

各模型获取 API 密钥：
- MiniMax: https://www.minimax.chat/
- 通义千问: https://dashscope.console.aliyun.com/
- 文心一言: https://console.bce.baidu.com/
- ChatGLM: https://open.bigmodel.cn/

## 🗺️ 路线图

| 版本 | 状态 | 内容 |
|---|---|---|
| v0.1-v0.5 | ✅ 已发布 | 数据模型 → React hook → 画布 → 边渲染 → 端口连线 |
| v0.5.1 | ✅ 已发布 | graph 数据层去重（5 个公开纯函数 API） |
| v0.5.2 | ✅ 已发布 | Relic 模块化（`src/relic/` + kinds registry） |
| **v0.5.3** | 📋 候选 | vitest + jsdom 加进 `devDependencies`（新人 clone 即跑测试） |
| **Strong #2** | 📋 候选 | `connect` 强制 DAG（调 `hasCycle`）+ `useNodeGraph.entityId` drift bug |
| v0.6 | 📋 计划 | 撤销/重做 |
| v0.7 | 📋 计划 | 持久化到 `.modstudio/Relics/{id}.json` + 从文件加载 |
| v0.8 | 📋 计划 | AI JSON Schema 落地（ADR-0002）— `buildNode` 已支持 AI 路径 |
| v0.9 | 📋 计划 | 扩展到其他 7 类实体（每类建自己的 `kinds.ts`，复用 kind registry 模式） |

详细架构决策见 [CONTEXT.md](./CONTEXT.md) 与 [docs/adr/](./docs/adr/)。

## 🤝 贡献

v0.5.2 起使用**多分支工作流**：

```bash
git checkout -b feature/<name>     # 从 main 创建分支
# 开发多个 commit，每个 commit 后 git push origin feature/<name>
git checkout main
git merge --no-ff feature/<name> -m "Merge branch 'feature/<name>' (vX.Y.Z <功能>)"
git push origin main
```

> ⚠️ **不要 `git add -A`** —— 可能误把无关 untracked 文件（如 `docs/` 报告）一起 commit。

提交信息建议格式：`<type>(<scope>): vX.Y.Z <内容> — <细节>`，例：`refactor(relic): v0.5.2 模块化 part 1/3 — 搬位置 + 改 import`

## 📚 学习资源

- [STS2 Wiki](https://sts2.wiki/)
- [RitsuLib](https://github.com/BAKAOLC/STS2-RitsuLib)
- [ModTemplate-StS2](https://github.com/CKRainbow/ModTemplate-StS2)
- [CONTEXT.md（领域模型 + 通用语言 + ADR 索引）](./CONTEXT.md)

## 📝 License

MIT
