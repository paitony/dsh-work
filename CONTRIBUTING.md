# 贡献指南

欢迎贡献！本仓库是 DeepSeek Harness 的开源桌面封装，核心代码在 `apps/desktop/`，其余为 harness 的插件体系。

## 开发环境

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

## 代码结构

- `apps/desktop/src/main.ts` — Electron 主进程（窗口、菜单、生命周期、权限检测）；
- `apps/desktop/src/boot.ts` — 进程内引导 harness（profile 组合、overlays、asar 链接修复）；
- `apps/desktop/src/picker.ts` — `directory-picker` 能力缝的 Electron 后端；
- `apps/desktop/src/permissions.ts` — macOS / Windows 能力检测与提醒；
- `apps/desktop/tests/smoke.ts` — 无头冒烟测试。

## 提交前检查

```sh
pnpm run build                        # 全量构建
pnpm --filter @deepseek-ai/dsh-desktop smoke   # 冒烟测试
pnpm --filter @deepseek-ai/dsh-desktop typecheck
```

## 提交规范

- 遵循 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:` 等）；
- 修改 `apps/desktop` 的公开行为（打包、权限、引导）时同步更新 README 与架构文档；
- 不提交构建产物（`lib/`、`dist/`、`release/`）与 `node_modules/`。
