# DeepSeek Harness Desktop

English: [README.md](README.md)

本目录是 [DeepSeek Harness](../../README.md) 的 Electron 桌面壳：把 harness 的 Web 组合封装成可安装的 Windows、macOS、Linux 应用。面向普通用户的下载安装说明在[仓库根 README](../../README.md)。

![运行中的桌面界面](../../assets/desktop-main-window.png)

更多真实运行状态见[软件运行截图](../../docs/screenshots.md)。

## 本目录负责什么

- `main.ts` 负责 Electron 窗口、菜单、单实例、导航安全策略、权限提醒、诊断日志和退出。
- `boot.ts` 在 Electron 主进程内启动 harness，使用与 CLI 相同的 `dsh-app-boot` profile 机制。
- `preload.cts` 向沙箱渲染进程暴露最小的只读 `dshDesktop` 接口。
- 渲染进程加载 harness 通过 loopback Web 服务提供的官方 Web GUI；本目录不维护第二套桌面 UI，也不重复实现目录选择器。

目录选择器通过 harness 的 `directory-picker` capability 和平台原生 provider 提供。这样桌面端和无头模式使用同一条能力路径。

## 运行逻辑

1. Electron 获取单实例锁，并调用 `bootDesktop()`。
2. `boot.ts` 加载 `web` profile，叠加用户层和桌面 overlay，然后等待 Web 服务绑定 `127.0.0.1` 的系统随机端口。
3. `main.ts` 在该 loopback 地址打开沙箱 `BrowserWindow`。页面加载 harness HTML、`/plugins` 客户端 bundle、`/api` RPC 和 WebSocket 事件。
4. 用户退出时，桌面壳等待启动 Promise 结束，销毁 Cordis 插件树，再退出 Electron 进程。

完整组件图和运行时序图见[架构文档](../../docs/architecture.md)。

## 本地开发

前置条件：Node.js `^22.19 || >=24`、pnpm 11 和 Git。普通用户下载的已打包应用不需要 Node.js 或 pnpm。

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

以下检查不需要显示器或真实 API Key：

```sh
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop test:lifecycle
```

`smoke` 会在临时 Harness home 中启动组合，并检查 GUI 引导清单、`/plugins` 下的客户端 bundle 和 `host.describe` RPC。

## 打包

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac
pnpm --filter @deepseek-ai/dsh-desktop dist:win
pnpm --filter @deepseek-ai/dsh-desktop dist:linux
```

产物写入 `apps/desktop/release/`。macOS 指定架构时使用 `dist:mac:arm64` 或 `dist:mac:x64`。当前不提供 Universal 包，因为应用包含不能安全合并的架构专用原生模块。
Windows 和 Linux 最好在对应的 CI runner 上构建并启动验收；macOS 可以交叉构建出文件，但不能替代目标平台测试。

electron-builder 会解包 `node_modules/**`，因为 harness 的 profile fallback 使用的文件系统链接无法穿过 `app.asar` 文件。Agent 预设随包放在 `config/agent-presets`。签名、公证、CI 目标和清理说明见[构建文档](../../docs/building.md)。

## 用户数据与安全边界

Harness 数据存放在 `~/.dsh`，并与 `dsh` CLI 共享。Electron 壳自己的状态存放在 Electron 的 `userData` 目录。渲染进程启用上下文隔离和沙箱，并关闭 Node 集成；页面导航限制在本次启动的 loopback origin，允许的外部链接交给系统浏览器打开。[质量文档](../../docs/quality.md)记录了验证证据以及内存泄漏检查的边界。

## 源码结构

| 路径 | 职责 |
|---|---|
| `src/main.ts` | Electron 进程、窗口、菜单、生命周期和诊断 |
| `src/boot.ts` | Harness profile 组合、overlay 和销毁 |
| `src/preload.cts` | 沙箱 preload 接口 |
| `src/permissions.ts` | 系统能力检查与提醒 |
| `src/window-policy.ts` | loopback 导航和外部 URL 策略 |
| `tests/` | 冒烟、生命周期和导航策略检查 |
| `electron-builder.yml` | 平台目标和打包文件规则 |
