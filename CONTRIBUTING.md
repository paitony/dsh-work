# 贡献指南

欢迎贡献！本仓库是 DeepSeek Harness 的开源桌面封装，核心代码在 `apps/desktop/`，其余为 harness 的插件体系。

## 开发环境

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

## 代码结构

- `apps/desktop/src/main.ts` — Electron 主进程（窗口、菜单、单实例、导航安全、生命周期、权限检测）；
- `apps/desktop/src/boot.ts` — 进程内引导 harness（profile 组合、桌面 overlays、asar 链接修复、错误解包）；
- `apps/desktop/src/preload.cts` — 沙箱 preload（暴露最小 `dshDesktop` 表面）；
- `apps/desktop/src/permissions.ts` — macOS / Windows 能力检测与一次性权限提醒；
- `apps/desktop/src/window-policy.ts` — loopback 导航与允许的外部 URL 策略；
- `apps/desktop/tests/` — `smoke.ts` 无头端到端、`lifecycle.ts` 生命周期、`window-policy.ts` 窗口策略；
- `apps/desktop/config/agent-presets/` — 内置 agent 预设（standard/code/cordis/minimal）。

目录选择器通过 harness 的 `directory-picker` capability 复用平台原生 provider（macOS osascript、Windows IFileOpenDialog、Linux zenity/kdialog），桌面壳不再维护独立的 picker 实现。

## 提交前检查

```sh
pnpm run build                        # 全量构建
pnpm --filter @deepseek-ai/dsh-desktop smoke   # 冒烟测试
pnpm --filter @deepseek-ai/dsh-desktop test:policy # Electron URL 策略回归测试
pnpm --filter @deepseek-ai/dsh-desktop test:lifecycle # 重复 boot/dispose 生命周期测试
pnpm --filter @deepseek-ai/dsh-desktop typecheck
```

## 提交规范

- 遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` 等）；
- 修改 `apps/desktop` 的公开行为（打包、权限、引导）时同步更新 README 与架构文档；
- 不提交构建产物（`lib/`、`dist/`、`release/`）与 `node_modules/`。