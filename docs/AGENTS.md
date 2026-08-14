# 项目文档维护说明

这里维护 DeepSeek Harness Desktop 的发布文档。当前文档范围只有根 README、桌面端 README、架构、构建发布、质量验证和运行截图；不要添加指向不存在的 `docs/user/`、`docs/subsystems/` 或 `website/` 的项目说明。

`docs/architecture.md` 说明 Electron 主进程、Harness 插件树、loopback Web 服务和渲染进程之间的关系，并同时保留架构图与启动时序图。代码目录或启动流程变化时，先更新这份文档，再同步根 README 的摘要链接。

`docs/building.md` 是本地构建、平台打包、签名、公证和 tag 发布流程的唯一说明。GitHub Actions 的具体行为以 `.github/workflows/build.yml` 和 `.github/workflows/release.yml` 为准；文档只解释触发条件和用户需要执行的命令，不复制整份 YAML。

`docs/quality.md` 记录 Electron 安全设置、退出回收、自动化检查和人工平台验收边界。不能把短时 smoke 或静态检查表述成绝对没有内存泄漏；长时间会话仍要按文档中的平台清单验收。

`docs/screenshots.md` 只引用仓库内可追溯的实际运行截图。新增或替换截图时，使用不含 API Key 的真实界面，并在文档中说明截图对应的应用状态。

修改文档后运行 `pnpm run check-project-docs`、`pnpm run verify-mermaid`、`pnpm run verify-md-wrap` 和 `pnpm run verify-public-repository-links`。涉及 TypeScript API 或构建流程时，再运行对应的 typecheck、build 和桌面端 smoke 检查。
