# 仓库解析报告（2026-08-04）

> 目标：解析当前仓库（mod-studio）并下载 https://github.com/yituorou/meatshell

## 1. 下载与落盘

| 仓库 | 路径 | 远端 | HEAD |
|---|---|---|---|
| mod-studio（当前仓库） | `/home/xingyahui/mod-studio` | `git@gitcode.com:yishuangyz/1.git` | `6ead984`（feat(node-editor): v0.5 端口 click-to-connect） |
| meatshell（已下载） | `/home/xingyahui/meatshell` | `https://github.com/yituorou/meatshell.git` | `588f151`（修复 glibc 基线检查的 SIGPIPE 失败） |

meatshell 是 Rust 仓库，体积较大；首次 `git clone` 在 2 分钟内超时，已改用 `--depth 1` 完成浅克隆。

## 2. 当前仓库 mod-studio 解析

### 2.1 一句话定位

**杀戮尖塔 2（Slay the Spire 2）Mod 图形化开发工具**：用户用表单/AI 对话生成 8 类实体（卡牌/角色/遗物/药水/事件/敌人/Buff/UI），一键编译出 Godot C#/GDScript，发布到 Steam Workshop。

### 2.2 技术栈

| 层 | 选型 | 版本 |
|---|---|---|
| 桌面壳 | Electron | ^28 |
| 前端框架 | React | ^18 |
| 语言 | TypeScript | ^5.3 |
| 状态管理 | Zustand（带 persist） | ^4.4 |
| 模板引擎 | Mustache（C# 模板） | ^4.2 |
| 构建 | Vite + electron-builder | ^5 / ^24.9 |
| 测试 | Vitest + jsdom + Testing Library | — |

### 2.3 目录结构（核心）

```
mod-studio/
├── electron/                  # 主进程
│   ├── main.ts               # 窗口、IPC、文件操作、游戏启动
│   └── preload.ts            # contextBridge 暴露 API
├── src/
│   ├── App.tsx               # 主应用（多 tab 路由）
│   ├── components/           # 18 个 UI 组件
│   │   ├── CardEditor.tsx            # E1 卡牌编辑器（已实现）
│   │   ├── RelicEditor.tsx           # E3 遗物编辑器（已实现）
│   │   ├── AIGenerator.tsx           # LLM 多 provider 生成
│   │   ├── GameLauncher.tsx          # 一键启动游戏测试
│   │   ├── NewProjectModal.tsx       # 新建 Mod 项目
│   │   ├── Tutorial.tsx              # 8 步新手教程
│   │   ├── TaskGuide.tsx             # 任务引导
│   │   └── ...                       # About/Settings/Theme/ErrorBoundary 等
│   ├── node-editor/          # 自研节点编辑器（ADR-0001，不引入 react-flow）
│   │   ├── NodeGraphCanvas.tsx       # SVG 画布 + 拖拽 + 端口 click-to-connect
│   │   ├── graph.ts                  # 节点图纯逻辑（边、路径、校验）
│   │   ├── useNodeGraph.ts           # React hook（hook 层与 SVG 渲染解耦）
│   │   ├── codegen.ts                # 节点图 → Godot C# 代码（v0.4）
│   │   └── types.ts                  # GraphNode / NodeGraph / PortDef
│   ├── stores/               # Zustand 状态
│   │   ├── useCardStore.ts           # 卡牌 + persist
│   │   ├── useAIStore.ts             # AI 配置 + persist
│   │   ├── useTaskStore.ts           # 任务进度
│   │   └── useProjectStore.ts
│   ├── services/
│   │   ├── FileService.ts            # 文件读写封装
│   │   └── llm/adapters/             # MiniMax / 通义千问 / 文心 / ChatGLM 适配器
│   ├── utils/                # 工具（cardParser / codeGenerator / theme / stringUtils）
│   └── templates/            # Mustache 模板（card.mustache）
└── docs/
    ├── CONTEXT.md            # 领域模型 v1.0
    ├── adr/                  # ADR-0001~0004
    └── handoff-2026-08-03.md # 最近一次交接
```

### 2.4 关键架构决策（来自 `docs/adr/` + CONTEXT.md）

- **ADR-0001**：节点编辑器自研，不引入 react-flow（避免 1 MB+ 体积 + 不可定制的渲染）。
- **ADR-0002**：AI 输出结构化 JSON，不解析自然语言（保证可重放、可校验）。
- **ADR-0003**：本地文件夹项目结构（不云端，单机创作）。
- **ADR-0004**：多 mod 模式（用户管理多个项目）。

### 2.5 项目状态（截至 2026-08-04）

- ✅ E1 卡牌（表单 + AI 单次生成）；E3 遗物（表单 + 节点图）
- ✅ Electron + React + TS + Zustand
- ✅ Mustache → C# 代码生成；HTTP LLM 4 provider
- ✅ 8 步新手教程 + 6 步任务引导
- ✅ 129 个单元/集成/组件测试（16 个测试文件 + 40 个源文件）
- ✅ Git 已建立，最近 5 个提交全部围绕节点编辑器 v0.2 → v0.5
- ❌ E2/E4-E8 编辑器（除 E1/E3 外）
- ❌ AI 多轮对话迭代
- ❌ 一键发布 Steam Workshop

### 2.6 当前焦点：节点编辑器 v0.5（最新提交）

- **画布**：`NodeGraphCanvas.tsx` 用裸 SVG（`<g>` + `<rect>` + `<text>` + `<path>`），无任何第三方依赖
- **交互**：拖拽 = `mouseDown/move/up` + `getScreenCTM().inverse()` 反算 SVG 坐标
- **边**：贝塞尔 `<path>`（`graph.ts` 的 `edgePath()`）
- **连接**：端口 click-to-connect——先点 output 选中 source，再点 input 触发 `onConnect`
- **校验**：类型系统（trigger/condition/effect/branch 四色 + 端口定义 `NODE_PORT_DEFS`）
- **代码生成**：`codegen.ts` 把节点图编译成 Godot C#（v0.4 已支持 Relic 端到端）

## 3. 新下载的 meatshell 解析

### 3.1 一句话定位

**轻量级 SSH/终端客户端**：受 FinalShell 启发，Rust + Slint 实现，把内存从 400 MB+ JVM 压到几十 MB 原生级别。提供多标签终端、SFTP、SSH 隧道（-L/-R/-D）、资源监控（CPU/内存/网络/磁盘）、串口/Telnet、出站代理等功能。

### 3.2 技术栈

| 模块 | 选型 |
|---|---|
| UI | **Slint**（纯 Rust 编译，无 GC；macOS 可选 Skia 渲染） |
| 异步运行时 | tokio（rt-multi-thread + macros + sync + io-util + net + time + fs） |
| SSH 协议 | **russh** 0.49（纯 Rust，无 libssh；因 RUSTSEC-2026-0154 暂未升级） |
| 系统指标 | sysinfo 0.33 |
| 终端模拟 | vt100 0.15 |
| PTY | portable-pty 0.8 |
| 序列化 | serde + serde_json |
| 日志 | tracing + tracing-subscriber（stderr + 50 MiB 滚动 error.log） |
| 密钥 | ssh-key 0.6；PuTTY PPK v2/v3 自实现解析（aes/cbc/argon2/hmac/sha1/sha2） |
| 密码加密 | chacha20poly1305（ChaCha20-Poly1305 AEAD） |
| 端口 | serialport 4（COM3 / /dev/ttyUSB0） |
| 代理 | tokio-socks 0.5（SOCKS5）；HTTP CONNECT 自实现 |
| 剪贴板 | arboard 3（Linux 加 wayland-data-control） |
| 字体 | fontdb 0.16（Interface 设置字体选择器） |
| Emoji | twemoji-assets 1.5（72px PNG 内嵌，避免 Slint 文字光栅化丢色） |
| 系统主题 | dark-light 1（首次启动跟随系统） |
| 自动更新 | ureq 2（后台线程查 GitHub Releases API） |
| 图像 | image 0.25（PNG/JPEG/WebP/BMP 自定义壁纸 + Linux 窗口图标） |

### 3.3 目录与代码量

| 部分 | 文件数 | 行数 |
|---|---|---|
| `src/*.rs` 总计 | 47 | ~12,500 |
| `src/app.rs`（UI ↔ 后端桥接主文件） | 1 | **10,951** |
| `src/main.rs`（入口 + tracing 初始化） | 1 | 109 |
| `ui/*.slint` 总计 | 13 | ~12,300 |
| `ui/app.slint`（顶层窗口） | 1 | **4,016** |
| `ui/terminal_view.slint` | 1 | 1,891 |
| `ui/sftp_panel.slint` | 1 | 1,061 |
| `ui/session_dialog.slint` | 1 | 1,090 |

### 3.4 子系统布局

```
src/
├── main.rs                # 入口；init_tracing() 含噪声过滤 + 滚动日志
├── app.rs                 # 10951 行！UI ↔ 后端全部桥接
├── config/                # 会话 JSON 持久化（含密码加密）
├── session/               # 会话数据结构 + impls
├── ssh/                   # SSH 会话 worker（russh 0.49）
├── sftp/                  # 文件浏览 + 拖拽上传/下载
├── terminal/              # vt100 渲染 + ZMODEM (sz) 接收
├── tunnel/                # 端口转发 -L/-R/-D
├── resource/              # CPU/内存/网络/磁盘采样（sysinfo）
├── ui/                    # UI 桥接辅助结构
├── layout/                # 窗口布局
├── i18n/                  # 国际化（中/英）
├── logging/               # CappedFile 50 MiB 滚动
├── wallpaper/             # 自定义壁纸
└── webdav/                # WebDAV 远程挂载
```

### 3.5 UI 布局（`ui/`）

| 文件 | 用途 |
|---|---|
| `app.slint` | 顶层窗口（菜单/快捷键/全局状态） |
| `theme.slint` | 设计 tokens（颜色/间距/字号） |
| `widgets.slint` | 复用按钮/输入框/sparkline |
| `sidebar.slint` | 左侧本机资源监控 |
| `tabs.slint` | 顶部标签栏 |
| `welcome.slint` | 欢迎页/快速连接 |
| `session_dialog.slint` | 新建/编辑会话弹框（密码/私钥/代理/隧道） |
| `terminal_view.slint` | 终端视图（含隐藏 IME `ime-input` 解决中文输入） |
| `sftp_panel.slint` | SFTP 文件浏览 |
| `interface_panel.slint` | 设置（主题/字体/渲染器后端/Skia 切换） |
| `proc_window.slint` | 远端进程监控（htop 风格） |
| `system_info_window.slint` | 远端系统信息 |
| `confirm_dialog.slint` | 通用确认弹框 |

### 3.6 工程亮点

1. **渲染器后端可选**：默认 femtovg；macOS 编译时带 `renderer-skia`，用户可在设置里切换（解决 #108/#129 的"所有文字消失"问题）。
2. **IME 策略**：`main.rs` 注释里写了**不调用** `ImmDisableIME`——中文输入靠 `terminal_view.slint` 的隐藏 `ime-input` TextInput + `edited` 回调。Backspace 过滤在 `app::on_send_key` 用 C0-marker + 3 层逻辑处理。
3. **会话密码加密**：ChaCha20-Poly1305（key 在 `zeroize` drop 时清零）。
4. **PPK 支持**：原生 v2/v3 解析（Argon2 KDF + AES-CBC + HMAC），不走外部工具。
5. **审计豁免**：`audit.toml` 声明 `russh = 0.49` 的 RUSTSEC-2026-0154 因 meatshell 不使用 ssh-agent 而不可达，等上游依赖出 -rc 后再升级（PR #151）。
6. **CI**：GitHub Actions 在 `v*` tag 自动构建 Win/Linux/macOS 三平台二进制 + 推送到 AUR。
7. **发版脚本**：`scripts/release.ps1` 自动 bump 版本 + `cargo check --locked` + 验证 `--version` + 打 annotated tag + push。

## 4. 两个仓库的对比要点

| 维度 | mod-studio | meatshell |
|---|---|---|
| 类型 | Electron 桌面工具 | Rust 原生桌面工具 |
| 用户目标 | 不写代码的 Mod 作者 | 服务器运维/SSH 重度用户 |
| UI 技术 | React + TSX（JSX 体系） | Slint DSL（编译期生成代码） |
| 体积 | Electron 包 ~150 MB+ | 原生二进制 ~10 MB 级 |
| 代码量 | TS 源 40 个 + 测试 16 个 | Rust 47 + Slint 13，单文件 1 万行级 |
| 当前焦点 | 节点编辑器（v0.5，已能 Relic 端到端） | macOS Skia 切换 / IME / 串口 |
| 跨平台 | Win/macOS（README 没提 Linux，但 Electron 跨平台） | Win/Linux/macOS 全平台 + AUR |

## 5. meatshell 里值得 mod-studio 借鉴的点

- **`audit.toml` 安全豁免声明**：当依赖有 CVE 但代码路径不可达时，显式记录原因，便于审计。
- **`init_tracing` 噪声过滤**：把第三方日志（ICU4X、fontdb）按 target 过滤到 off/error，避免淹没用户。
- **`zeroize` drop**：敏感内存立即清零（密码、私钥句柄）。
- **大文件单源结构**：`app.rs` 10951 行 + `app.slint` 4016 行——Slint/React UI 与后端强耦合时的折衷（桥接层全在一个文件里，避免"一个回调散落 5 个文件"）。
- **CI 多平台构建矩阵 + 自动 AUR 发布**：mod-studio 当前用 electron-builder 仅打 Win/macOS，未来加 Linux 可以参考 meatshell 的 AUR 工作流。
- **PPK 解析思路**：如果 mod-studio 要支持"从游戏 modder 用户的 PuTTY 私钥加载……"——其实不直接相关，但"纯 Rust 解析私有格式 + 完整注释"的工作流值得学习。