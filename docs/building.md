# 构建与发布

## 本地构建

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
# macOS 通用包（双架构；需要在支持的 macOS 构建机上执行）
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:universal
# Windows
pnpm --filter @deepseek-ai/dsh-desktop dist:win
# Linux
pnpm --filter @deepseek-ai/dsh-desktop dist:linux
```

产物输出到 `apps/desktop/release/`。

`dist:mac` 只构建当前主机架构；它不会同时生成 arm64 和 x64。跨架构发布应分别构建两个单架构包，或在 macOS 构建机上运行 Universal 目标。Windows 和 Linux 产物必须在对应操作系统上构建，GitHub Actions 不能在 macOS 上交叉生成可靠的原生安装包。

## 本地验证顺序

```sh
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64
```

`smoke` 使用临时 Harness home 验证 loopback HTTP、`__DSH_BOOT__`、客户端 bundle 和 `host.describe` RPC；`dist:mac:arm64` 再验证 Electron builder 能生成可分发的 macOS 包。真实用户流程仍需在每个目标操作系统上手动打开安装包验证。

### 关于 macOS 双架构

- `--arm64` 与 `--x64` 分别产出单架构包，用户按芯片下载；
- `--universal` 由 `@electron/universal` 合并两架构为 fat binary（体积约为两倍）；
- 原生模块（`node-pty`、`koffi`、`node-addon-*`）各架构各一个 `.node`，无法 lipo 合并，配置了 `singleArchFiles: "**/*.node"` 保持不合并，运行时自动加载对应架构文件。

## 签名与公证

### macOS

1. 在 Apple Developer 生成 **Developer ID Application** 证书并导出 `.p12`；
2. 构建时提供证书：

```sh
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD=yourpassword
export APPLE_ID=you@example.com        # 公证账号
export APPLE_APP_SPECIFIC_PASSWORD=xxxx # 应用专用密码
export APPLE_TEAM_ID=TEAM1234AB
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:universal
```

3. electron-builder 会完成签名与公证（notarize）。未签名构建会触发 Gatekeeper 拦截。

### Windows

1. 购买/生成代码签名证书（OV/EV），导出 `.pfx`；
2. `export CSC_LINK=/path/to/cert.pfx && export CSC_KEY_PASSWORD=xxxx` 后执行 `dist:win`；
3. 未签名 exe 会触发 SmartScreen 警告。

## CI（GitHub Actions）

```yaml
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14        # arm64 + universal
            args: "--mac --universal"
          - os: windows-latest  # win x64
            args: "--win"
          - os: ubuntu-latest   # linux
            args: "--linux"
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install
      - run: pnpm run build
      - run: pnpm --filter @deepseek-ai/dsh-desktop exec electron-builder ${{ matrix.args }}
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          ELECTRON_MIRROR: https://npmmirror.com/mirrors/electron/
      - uses: actions/upload-artifact@v4
        with:
          path: apps/desktop/release/*
```

> 中国大陆网络环境下建议设置 `ELECTRON_MIRROR`（npmmirror）以加速 Electron 二进制下载。

## 发布到 Releases

将 `apps/desktop/release/` 下的安装包上传到 GitHub Releases，并在 README 的安装表中登记。

仓库中的 `.github/workflows/release.yml` 已把这一步自动化：推送 `v*` 标签后，在 macOS、Windows、Linux runner 上分别构建目标包，下载所有产物并创建 GitHub Release。提供签名和公证 secrets 时，electron-builder 会在对应平台执行正式签名；未提供时仍会生成可用于内部验收的未签名包。
