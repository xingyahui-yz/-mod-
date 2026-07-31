# Slay the Spire 2 Mod Studio

一款简洁的杀戮尖塔2 Mod开发工具。

## ✨ 功能特性

- 🃏 **可视化卡牌编辑器** - 表单填写，实时预览，自动生成C#代码
- 🤖 **AI智能生成** - 支持MiniMax、通义千问、文心一言、ChatGLM四大国产大模型
- 📚 **新手教程** - 8步交互式教程，零基础也能上手
- 📋 **任务系统** - 完整的任务引导，从创建到测试
- 🚀 **一键测试** - 自动启动游戏加载你的Mod
- 🎨 **主题切换** - 支持暗/亮主题
- 🛡️ **错误边界** - 友好的错误处理
- 💾 **数据持久化** - 配置和卡牌数据自动保存
- ✅ **单元测试** - 50个测试覆盖核心逻辑

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
├── electron/              # Electron主进程
│   ├── main.ts           # 窗口、IPC处理
│   └── preload.ts        # 安全API暴露
├── src/
│   ├── components/       # UI组件
│   │   ├── CardEditor.tsx        # 卡牌编辑器
│   │   ├── AIGenerator.tsx       # AI生成器
│   │   ├── GameLauncher.tsx      # 游戏启动
│   │   ├── NewProjectModal.tsx   # 新建项目
│   │   ├── SettingsModal.tsx     # 设置
│   │   ├── Tutorial.tsx          # 新手教程
│   │   ├── TaskGuide.tsx         # 任务引导
│   │   ├── ErrorBoundary.tsx     # 错误边界
│   │   ├── AboutModal.tsx        # 关于
│   │   ├── ThemeToggle.tsx       # 主题切换
│   │   └── Skeleton.tsx          # 骨架屏
│   ├── stores/           # Zustand状态
│   │   ├── useCardStore.ts       # 卡牌状态 (持久化)
│   │   ├── useProjectStore.ts    # 项目状态
│   │   ├── useAIStore.ts         # AI状态 (持久化)
│   │   └── useTaskStore.ts       # 任务状态
│   ├── services/         # 业务服务
│   │   ├── FileService.ts        # 文件操作封装
│   │   └── llm/adapters/         # LLM适配器
│   ├── utils/            # 工具函数
│   │   ├── cardUtils.ts          # 卡牌工具
│   │   ├── stringUtils.ts        # 字符串工具
│   │   ├── cardParser.ts         # C#代码解析
│   │   ├── codeGenerator.ts      # C#代码生成
│   │   └── theme.ts              # 主题管理
│   ├── templates/        # 模板
│   │   └── card.mustache         # C#卡牌模板
│   ├── hooks/            # React hooks
│   ├── App.tsx           # 主应用
│   └── main.tsx          # 入口
└── package.json
```

## 🚀 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建
npm run build

# 运行测试
npm test

# 监听模式运行测试
npm run test:watch
```

## 📖 使用说明

### 1. 创建项目
点击「新建项目」按钮，填写项目名称、Mod ID、作者等信息。

### 2. 创建卡牌
切换到「🃏 卡牌编辑器」标签，点击「新建卡牌」开始创建。

### 3. 编辑卡牌
填写卡牌的名称、费用、类型、稀有度、描述、关键词等属性。

### 4. 保存卡牌
点击「💾 保存到项目」，工具会自动生成C#代码并保存到你的Mod项目中。

### 5. AI智能生成
切换到「✨ AI生成」标签，配置API密钥（支持MiniMax、通义千问、文心一言、ChatGLM），
输入自然语言描述，AI会生成多个卡牌选项。

### 6. 测试游戏
切换到「🎮 游戏测试」标签，设置游戏路径，点击启动游戏测试。

## 🤖 AI模型配置

1. 打开AI生成标签
2. 选择模型提供商
3. 输入API密钥
4. 开始生成卡牌

各模型获取API密钥：
- MiniMax: https://www.minimax.chat/
- 通义千问: https://dashscope.console.aliyun.com/
- 文心一言: https://console.bce.baidu.com/
- ChatGLM: https://open.bigmodel.cn/

## 📚 学习资源

- [STS2 Wiki](https://sts2.wiki/)
- [RitsuLib](https://github.com/BAKAOLC/STS2-RitsuLib)
- [ModTemplate-StS2](https://github.com/CKRainbow/ModTemplate-StS2)

## 📝 License

MIT