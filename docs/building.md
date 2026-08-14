# 构建与发布

## 本地构建

构建机需要 Node.js `^22.19 || >=24`、pnpm 11 和 Git；普通用户下载已发布的安装包时不需要这些工具。

```sh
pnpm install
pnpm run build
```

## 桌面端打包

```sh
# macOS（当前主机架构）
pnpm --filter @deepseek-ai/dsh-desktop dist:mac
# macOS Apple Silicon
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64
# macOS Intel
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:x64
# Windows
pnpm --filter @deepseek-ai/dsh-desktop dist:win
# Linux
pnpm --filter @deepseek-ai/dsh-desktop dist:linux
```

产物输出到 `apps/desktop/release/`。`dist` 命令会先编译桌面壳，再调用 electron-builder 生成安装包。

`dist:mac` 只构建当前主机架构；它不会同时生成 arm64 和 x64。发布 macOS 时应分别构建两个单架构包。正式发布的 Windows 和 Linux 包推荐在对应 runner 上构建和验收，避免把交叉构建工具当成目标系统测试的替代品。

本地可以使用 Wine 等交叉构建工具尝试生成 Windows 包，但它不能替代 Windows runner 上的安装、启动和原生权限验收；正式发布以仓库的 Windows CI 产物为准。

## 本地验证顺序

```sh
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64
```

`smoke` 使用临时 Harness home 验证 loopback HTTP、`__DSH_BOOT__`、客户端 bundle 和 `host.describe` RPC；打包命令再验证 Electron builder 能生成安装包。真实用户流程仍需在每个目标操作系统上手动打开安装包验证。

### 关于 macOS 架构

- `--arm64` 与 `--x64` 分别产出单架构包，用户按芯片下载；
- 当前不发布 Universal 包：`node-pty`、`koffi`、`sharp` 等原生模块包含架构专用 `.node` 文件，不能由 electron-builder 安全合并为 fat binary；单架构包可以确保加载正确的原生模块。

## 签名与公证

### macOS

1. 在 Apple Developer 生成 **Developer ID Application** 证书并导出 `.p12`；
2. 构建时提供证书：

```sh
export MAC_CSC_LINK=/path/to/cert.p12
export MAC_CSC_KEY_PASSWORD=yourpassword
export APPLE_ID=you@example.com        # 公证账号
export APPLE_APP_SPECIFIC_PASSWORD=xxxx # 应用专用密码
export APPLE_TEAM_ID=TEAM1234AB
export CSC_LINK="$MAC_CSC_LINK"
export CSC_KEY_PASSWORD="$MAC_CSC_KEY_PASSWORD"
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64 # Apple Silicon；Intel 使用 dist:mac:x64
```

3. electron-builder 会完成签名与公证（notarize）。未签名构建会触发 Gatekeeper 拦截。

### Windows

1. 购买/生成代码签名证书（OV/EV），导出 `.pfx`；
2. `export WIN_CSC_LINK=/path/to/cert.pfx && export WIN_CSC_KEY_PASSWORD=xxxx && export CSC_LINK="$WIN_CSC_LINK" && export CSC_KEY_PASSWORD="$WIN_CSC_KEY_PASSWORD"` 后执行 `dist:win`；
3. 未签名 exe 会触发 SmartScreen 警告。

## CI（GitHub Actions）

仓库中的 workflow 文件是 CI 行为的唯一准确信息来源，不需要复制一份容易过时的 YAML 到文档中：

- [`build.yml`](../.github/workflows/build.yml) 在 `main` push 和 Pull Request 上使用 macOS、Windows、Linux 三个平台，执行安装、全量构建、桌面冒烟测试和桌面打包；
- [`release.yml`](../.github/workflows/release.yml) 在推送 `v*` 标签后，分别构建 macOS arm64、macOS x64、Windows x64 和 Linux x64，并把产物上传到 GitHub Release；
- Electron 二进制下载可以通过 `ELECTRON_MIRROR` 加速；仓库 CI 当前使用 `https://npmmirror.com/mirrors/electron/`。CI 使用 `MAC_CSC_LINK` / `MAC_CSC_KEY_PASSWORD` 和 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets，避免把一个平台的证书传给另一个平台；旧的通用 `CSC_LINK` 不会被 tag 发布流程使用，未配置新 secrets 时构建未签名包。

## 发布到 Releases

发布流程由 tag 驱动。tag 必须使用 `vX.Y.Z` 或 `vX.Y.Z-预发布标识` 格式；workflow 会把去掉 `v` 的版本号显式传给 electron-builder，所以安装包文件名和应用版本都跟随 tag，而不是读取旧的 workspace 版本号。

```sh
# 在 main 上完成检查并提交代码后
git checkout main
git pull --ff-only origin main
git push origin main
git tag -a v0.1.0-rc.9 -m "release: v0.1.0-rc.9"
git push origin v0.1.0-rc.9
```

仓库中的 `.github/workflows/release.yml` 已把这一步自动化：推送 `v*` 标签后，在 macOS、Windows、Linux runner 上分别构建目标包，下载所有产物并创建 GitHub Release。提供签名和公证 secrets 时，electron-builder 会在对应平台执行正式签名；未提供时仍会生成可用于内部验收的未签名包。
