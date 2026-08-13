# DeepSeek Harness Desktop

DeepSeek Harness 的 Electron 桌面壳：一个可在 Windows、macOS、Linux 安装运行的应用，
在进程内引导与 `dsh web` 完全相同的组合，在原生窗口中展示同一个浏览器 GUI。
不懂技术的普通用户无需接触终端：应用自动启动 harness、打开窗口，提供完整的 Web 功能集
——会话、工具、工作区/文件夹流程、模型设置、API Key 配置——并配有系统原生目录选择器。

## 工作原理

- Electron 主进程使用与 `dsh` CLI 相同的 profile 机制（`dsh-app-boot`）**在进程内**引导
  harness：`web` profile（`dsh-base` + `dsh-web-app` 包 + 用户的 `cordis.patch.yml` +
  全局用户层）。桌面 overlay 把 webserver 绑定到 loopback 的 OS 分配端口并关闭 URL 打印。
- 渲染进程加载的是 harness 自己在 loopback 服务上提供的 Web 前端，因此所有 `dsh web`
  行为逐字节一致——`/api` 网关、`/plugins` 客户端 bundle、WebSocket 事件下行、
  `window.__DSH_BOOT__` 引导清单全部来自 harness 本身。
- Electron 以 `--expose-internals` 启动，引导时将该 flag 镜像进 `process.execArgv`：
  vendored Cordis loader 依赖 Node 内部模块 loader（经 `node-addon-require-builtin`，
  Electron 中不可用）做 profile 锚定的插件解析。打包版通过打包后的 `node_modules`
  解析，因此该 flag 仅在从工作区运行时需要。
- `directory-picker` 能力缝由 Electron 后端（`dialog.showOpenDialog`）提供服务，
  替代派生的 osascript/zenity 子进程；无头引导仍回退到官方原生后端。
- 会话、设置、凭据（API Key）与工作区存放在 CLI 使用的同一个 Harness home（`~/.dsh`），
  CLI 与桌面应用共享状态。

## 开发

前置条件：Node `^22.19 || >=24`、pnpm 11。Electron 自带 Node；锁定的 Electron 主版本
内置的 Node 满足 harness 的引擎范围。

```sh
pnpm install
pnpm run build          # 构建工作区 lib 与 web 前端 dist
pnpm --filter @deepseek-ai/dsh-desktop dev   # 编译壳并启动 Electron
```

无头冒烟测试（不需要 Electron，不需要显示器）：

```sh
pnpm --filter @deepseek-ai/dsh-desktop smoke
```

它在临时 Harness home 上引导桌面组合并断言 GUI 契约：index 携带 `__DSH_BOOT__`、
客户端 bundle 可从 `/plugins` 获取、`/api/host.describe` 应答真实的 unary RPC。

## 打包

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac     # dmg + zip（arm64、x64）
pnpm --filter @deepseek-ai/dsh-desktop dist:win     # NSIS 安装器（x64）
pnpm --filter @deepseek-ai/dsh-desktop dist:linux   # AppImage + deb
```

产物输出到 `apps/desktop/release/`。本地构建未签名；发布分发需要 macOS Developer ID /
Windows 证书（`CSC_*`）以及 electron-builder 文档中的公证步骤。

打包版应用以解包形式（`asarUnpack: node_modules/**`）携带完整依赖闭包：
harness 通过符号链接维护 profile fallback（`~/.dsh/profiles/node_modules`），
而符号链接无法穿越 asar 归档（OS 层它是普通文件），因此闭包必须是真实目录。
随附的 agent 预设（standard/code/cordis/minimal）放在 `config/agent-presets`，
通过与 CLI 相同的 `agent-presets` overlay 挂载。

## 结构

| 文件 | 职责 |
|---|---|
| `src/boot.ts` | 不依赖 Electron 的 harness 引导：profile 组合、桌面 overlay、销毁 |
| `src/main.ts` | Electron 主进程：窗口、菜单、生命周期、截图验证模式 |
| `src/preload.cts` | 沙箱 preload，暴露最小 `dshDesktop` 表面 |
| `src/picker.ts` | `directory-picker` 缝的 Electron 后端 + overlay |
| `tests/smoke.ts` | 无头端到端引导检查 |
| `electron-builder.yml` | 跨平台打包目标 |

## 数据与持久化

harness 的用户数据统一存放在 Harness home（`~/.dsh`），与 `dsh` CLI 共享：
`sessions/` 存放各工作区的会话日志，`settings.yaml` 存放设置，`storages/` 存放
工作区列表与投影缓存，`profiles/` 存放组合配置。再次打开应用时会自动显示此前的
会话、消息与工作区。Electron 自身的 `userData`（macOS 上为
`~/Library/Application Support/@deepseek-ai/dsh-desktop`）只保存壳层状态：
诊断日志与一次性权限提醒的已读记录。

## 权限

应用启动时会自动检测系统能力缺口（仅提示，不阻塞启动），每个问题只提醒一次，
并提供直达系统设置面板的按钮：

- **macOS — 完全磁盘访问**：读写受保护的用户目录（桌面、文稿、下载）需要在
  系统设置中为该应用开启「完全磁盘访问」。检测会对每个存在的目录做一次临时写入
  探测；提醒会打开 `com.apple.preference.security?Privacy_AllFiles`。
- **macOS — Seatbelt**：当 `/usr/bin/sandbox-exec` 不可用（部分 macOS 版本已移除）
  时，harness 的终端命令工具会因沙箱缺失而禁用。检测会以最小配置探测，缺失时提醒。
- **Windows — PowerShell**：PowerShell 工具需要 pwsh（PowerShell 7）或 Windows 自带
  PowerShell 5.1；检测探测 PATH，两者皆无时提醒。Windows 沙箱（受限令牌 + ACL）
  不需要管理员权限。

除此之外无需其他权限：目录选择使用 Electron 对话框，打开路径使用系统默认应用，
出站 API 调用无需授权，服务器仅绑定 loopback。

## 双架构打包

Electron 自带 Node，用户无需安装 Node 或任何运行时。构建时选择架构
（参见 [electron-builder 文档](https://www.electron.build/docs/mac/)）：

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64      # Apple Silicon dmg + zip
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:x64        # Intel dmg + zip
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:universal  # 单个通用包，双架构
```

Universal 包由 @electron/universal 合并两个架构；原生模块（`node-pty`、`koffi`、
`node-addon-*`）保持不合并（`singleArchFiles: "**/*.node"`），运行时各自加载
对应架构的二进制。正式分发还需要代码签名（Developer ID）与公证——缺少时
Gatekeeper 会拦截下载，临时签名/未签名构建只能在构建它的那台机器上运行。

## 已知限制与后续工作

- 传输层是 harness 自带的 loopback HTTP 服务（代码库的浏览器形态）。架构笔记中规划的
  未来 Electron 形态——`file://` 渲染进程 + IPC 桥承载 fetch——可以在不改动客户端包的
  前提下通过替换传输层接入。
- 桌面引导未接入 `cordis.patch.yml` 热重载（配置 HMR）；修改后下次启动生效。
- 暂无应用图标与自动更新管道；发布渠道确定后均为 electron-builder 的表面工作。