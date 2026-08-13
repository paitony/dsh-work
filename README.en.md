# DeepSeek Harness Desktop

An open-source project that packages [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a fully plugin-based agent harness — into **Windows / macOS / Linux** desktop applications. End users do not need Node.js or any CLI tool: download an installer and run.

中文文档: [README.md](README.md)

## Features

- **Full feature parity**: the renderer is the official harness web GUI — sessions, tool calls, the workspace/folder flow, model and API-key settings, byte-identical to `dsh web`;
- **Zero runtime dependencies**: Electron bundles Node; all dependencies and the frontend dist ship inside the installer;
- **Native feel**: OS-native directory picker, native menus, single-instance, graceful harness shutdown on quit;
- **Cross-platform**: macOS (Intel / Apple Silicon / Universal), Windows, Linux packaging targets;
- **Permission guidance**: startup capability checks (macOS Full Disk Access / Seatbelt, Windows PowerShell) with one-time reminders and links into System Settings;
- **Own data**: sessions, settings and credentials persist under `~/.dsh`; reopening shows all previous runs.

## Building from source

### Prerequisites

- [Node.js](https://nodejs.org/) `^22.19 || >=24` (build-time only; the runtime is bundled by Electron)
- [pnpm](https://pnpm.io/) 11
- Git

### Install and build

```sh
git clone https://github.com/paitony/dsh-work.git
cd dsh-work

pnpm install        # install all workspace dependencies (including Electron)
pnpm run build      # build all harness libraries + the web frontend dist
```

### Development

```sh
pnpm --filter @deepseek-ai/dsh-desktop dev   # compile the desktop shell and launch Electron
pnpm --filter @deepseek-ai/dsh-desktop smoke # headless smoke test (no display needed)
```

## Packaging & release

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64      # macOS Apple Silicon (dmg + zip)
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:x64        # macOS Intel
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:universal  # macOS universal (fat binary)
pnpm --filter @deepseek-ai/dsh-desktop dist:win            # Windows NSIS installer
pnpm --filter @deepseek-ai/dsh-desktop dist:linux          # Linux AppImage + deb
```

Artifacts land in `apps/desktop/release/`. Release distribution requires code signing and notarization (macOS Developer ID, Windows certificate); unsigned builds are blocked by Gatekeeper / SmartScreen. See `docs/building.md` for CI and signing guidance.

## Architecture

The Electron main process boots the harness in-process (reusing `dsh-app-boot` profile machinery) and the renderer loads the official harness web frontend. See [docs/architecture.md](docs/architecture.md) for Mermaid diagrams.

## Data & persistence

User data lives in `~/.dsh` (shared with the `dsh` CLI): `sessions/`, `settings.yaml`, `storages/`, `profiles/`. Reopening the app shows previous sessions and workspaces automatically.

## License

MIT — see [LICENSE](LICENSE). This repository contains source code of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT) and the vendored Cordis framework.
