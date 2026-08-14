# 质量与发布验证

本文记录桌面封装的可检查保证、自动化证据和仍需要在目标系统上完成的验证。它不把一次成功启动夸大为“所有平台、所有用户环境都没有问题”，而是明确每项结论的证据范围。

## Electron 安全边界

- `BrowserWindow` 开启 `contextIsolation`、`sandbox`，关闭 `nodeIntegration`；preload 只暴露只读的 `dshDesktop` 信息，不暴露 Node、IPC 或任意文件操作。
- 渲染器只允许留在启动时记录的 loopback origin；跨 origin 导航会被拦截并交给系统浏览器处理。
- `window.open` 和菜单外链只接受 `http`、`https`、`mailto`；`file`、`javascript`、`data` 等协议不会交给 `shell.openExternal`。
- Harness webserver 强制绑定 `127.0.0.1` 的随机端口，API 的现有 Host/Origin 信任栅栏仍由 harness 自己负责。

## 生命周期与内存

- 主进程持有唯一的 harness 引用；退出时等待启动 Promise settling，再等待 Cordis 根 fiber 销毁，最后才调用 `app.exit(0)`。
- 窗口 `closed` 事件清空引用，macOS 的 `activate` 可以重新创建窗口；重复退出请求不会重复销毁树。
- 诊断日志使用单一 append chain，并限制单条日志长度；渲染器不再监听高频 `console-message` 事件，因此不会积压无界的异步写入或把大量页面日志保留在 Promise 队列中。
- `apps/desktop/tests/smoke.ts` 验证一次完整 boot → HTTP/API → dispose；`tests/lifecycle.ts` 连续启动和销毁多个实例，验证端口与插件树能重复回收。

静态审查和短周期回收测试不能证明 Chromium、原生模块或所有第三方插件在长时间会话中绝对没有泄漏。发布前仍应在 macOS、Windows、Linux 各跑一次 30–60 分钟的真实对话/工具流程，用 Chromium Task Manager 或系统进程监视器记录主进程、renderer 和 GPU 进程的 RSS，确认空闲后能回落且重复打开/关闭窗口不持续增长。

## 自动化检查

```sh
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop test:lifecycle
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm run build
pnpm run verify-mermaid
```

其中 `smoke` 不需要 API Key 或显示器；它只验证本地组合和 GUI 传输契约，不向 DeepSeek API 发送请求。真实模型请求、权限弹窗、原生目录选择器和安装后启动必须在目标系统上另行验收。

实际运行界面截图见[软件运行截图](screenshots.md)。

## 发布前清单

- 在 macOS 分别构建 arm64、x64 包，并在相应硬件上启动一次；在 Windows 和 Linux runner 上分别构建并启动对应安装包。
- 检查安装包包含 `app.asar`、`app.asar.unpacked/node_modules`、前端 dist 和 `config/agent-presets`，且首次运行使用隔离的测试 `DSH_HOME`。
- 使用 Developer ID / Windows 代码签名证书完成签名；macOS 完成 notarization；发布页提供校验和、架构和已知权限要求。
- 不把 `lib/`、`dist/`、`release/`、用户的 `~/.dsh` 或任何 API Key 提交到仓库。
