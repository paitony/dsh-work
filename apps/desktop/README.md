# DeepSeek Harness Desktop

中文文档: [README.zh.md](README.zh.md)

The Electron desktop shell for [DeepSeek Harness](../../README.md): one installable
app for Windows, macOS, and Linux that boots the exact `dsh web` composition and
shows the same browser GUI in a native window. Non-technical users never touch a
terminal: the app starts the harness, opens the window, and exposes the full web
feature set — sessions, tools, the workspace/folder flow, model settings, and the
API-key setup — with an OS-native directory chooser.

![Running desktop interface](../../assets/desktop-main-window.png)

Additional real application states: [runtime screenshot gallery](../../docs/screenshots.md).

## How it works

- The Electron main process boots the harness **in-process** with the same
  profile machinery the `dsh` CLI uses (`dsh-app-boot`): the `web` profile
  (`dsh-base` + `dsh-web-app` bundles + the user's `cordis.patch.yml` + the
  home-level layer). Desktop overlays bind the webserver to a loopback
  OS-assigned port and silence the URL line.
- The renderer is the harness's own web frontend served over that loopback
  server, so every `dsh web` behavior is byte-identical — the `/api` gateway,
  the `/plugins` client bundles, the WebSocket event downlinks, and the
  `window.__DSH_BOOT__` boot manifest all come from the harness itself.
- Electron launches with `--expose-internals` and the boot mirrors it into
  `process.execArgv`: the vendored Cordis loader uses Node's internal module
  loader (via `node-addon-require-builtin`, unavailable in Electron) for
  profile-anchored plugin resolution. Packaged builds resolve through the
  packed `node_modules` instead, so the flag is only needed when running from
  the workspace.
- The `directory-picker` capability seam is served by an Electron backend
  (`dialog.showOpenDialog`) instead of a spawned osascript/zenity child, while
  the stock native backend remains the fallback for headless boots.
- Sessions, settings, credentials (the API key), and the workspace live in the
  same Harness home (`~/.dsh`) the CLI uses, so the CLI and the desktop app
  share state.

## Development

Prerequisites: Node `^22.19 || >=24`, pnpm 11. Electron ships its own Node; the
pinned Electron major bundles a Node satisfying the harness engine range.

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

Headless smoke test (no Electron, no display):

```sh
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop test:lifecycle
```

It boots the desktop composition against a throwaway Harness home and asserts
the GUI contract: index carries `__DSH_BOOT__`, a client bundle serves from
`/plugins`, and `/api/host.describe` answers a real unary RPC.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac
pnpm --filter @deepseek-ai/dsh-desktop dist:win
pnpm --filter @deepseek-ai/dsh-desktop dist:linux
```

Artifacts land in `apps/desktop/release/`. Local builds are unsigned; release
distribution needs a macOS Developer ID / Windows certificate (`CSC_*`) and the
notarization step documented by electron-builder.

The packaged app ships the full dependency closure unpacked
(`asarUnpack: node_modules/**`): the harness links its profile fallback
(`~/.dsh/profiles/node_modules`) by symlink, and symlinks cannot traverse an
asar archive (a plain file at the OS level), so the closure must be real
directories. The shipped agent presets (standard/code/cordis/minimal) travel
in `config/agent-presets` and are mounted through the same `agent-presets`
overlay the CLI uses.

## Structure

| File | Owns |
|---|---|
| `src/boot.ts` | Electron-free harness boot: profile composition, desktop overlays, teardown |
| `src/main.ts` | Electron main: window, menu, lifecycle, screenshot verification mode |
| `src/preload.cts` | Sandboxed preload exposing the minimal `dshDesktop` surface |
| `src/picker.ts` | The `directory-picker` seam's Electron backend + overlay |
| `tests/smoke.ts` | Headless end-to-end boot check |
| `icon.png` | Cross-platform application icon |
| `electron-builder.yml` | Cross-platform packaging targets |

## Data and persistence

The harness owns its user data in the Harness home (`~/.dsh`), shared with the
`dsh` CLI: `sessions/` holds the per-workspace session logs, `settings.yaml`
the settings, `storages/` the workspace list and projection caches, and
`profiles/` the composition. Opening the app again shows every previous
session, message, and workspace automatically. Electron's own `userData`
(`~/Library/Application Support/@deepseek-ai/dsh-desktop` on macOS) holds only
shell-level state: the diagnostic log and the one-time permission-reminder
acknowledgements.

## Permissions

The shell detects OS capability gaps at startup (advisory only — it never
blocks launching) and reminds the user once per issue, with a button that opens
the relevant System Settings pane:

- **macOS — Full Disk Access**: reading or writing the protected user
  directories (Desktop, Documents, Downloads) requires granting the app
  `完全磁盘访问` in System Settings. The check probes each present directory
  with a temporary write; the reminder opens
  `com.apple.preference.security?Privacy_AllFiles`.
- **macOS — Seatbelt**: the harness's bash tool fails closed when
  `/usr/bin/sandbox-exec` is unavailable (removed on some macOS releases). The
  check probes it with a trivial profile and warns when missing.
- **Windows — PowerShell**: the PowerShell tool needs pwsh (PowerShell 7) or
  Windows PowerShell 5.1; the check probes PATH and warns when neither exists.
  The Windows sandbox (restricted token + ACL) needs no elevation.

No other permission is required: the directory picker uses Electron's dialog,
path opening uses the OS default app, outbound API calls need no grant, and the
server binds loopback only.

## Packaging for both Mac architectures

Electron bundles its own Node, so users never install Node or any other
runtime. Choose the architecture at build time (see the
[electron-builder docs](https://www.electron.build/docs/mac/)):

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:arm64
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:x64
pnpm --filter @deepseek-ai/dsh-desktop dist:mac:universal
```

The universal build merges the two architectures with @electron/universal;
native modules (`node-pty`, `koffi`, `node-addon-*`) stay unmerged
(`singleArchFiles: "**/*.node"`) so each arch loads its own binary. Release
distribution additionally needs code signing (Developer ID) and notarization —
without them Gatekeeper blocks the download, and an ad-hoc/unsigned build only
runs on the machine that built it.

## Known Limitations and Deferred Work

- The transport is the harness's own loopback HTTP server (the codebase's
  browser shape). The architecture notes' future Electron shape — `file://`
  renderer with fetch carried over an IPC bridge — can slot in later by
  swapping the transport without touching the client packages.
- `cordis.patch.yml` hot-reload (config HMR) is not wired in the desktop boot;
  edits take effect on the next app start.
- No auto-update pipeline yet; it is electron-builder surface work once a
  release channel exists.
