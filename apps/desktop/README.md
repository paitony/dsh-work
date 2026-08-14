# DeepSeek Harness Desktop

中文文档: [README.zh.md](README.zh.md)

This directory contains the Electron shell for [DeepSeek Harness](../../README.md).
It packages the harness web composition into an installable Windows, macOS, and Linux
application. End-user installation instructions live in the [repository README](../../README.md).

![Running desktop interface](../../assets/desktop-main-window.png)

Additional real application states: [runtime screenshot gallery](../../docs/screenshots.md).

## What this package owns

- `main.ts` owns the Electron window, menu, single-instance lock, navigation policy,
  permission reminders, diagnostics, and shutdown.
- `boot.ts` boots the harness in the Electron main process through the same
  `dsh-app-boot` profile machinery used by the CLI.
- `preload.cts` exposes the small, read-only `dshDesktop` surface to the sandboxed renderer.
- The renderer is the harness Web GUI served by the harness loopback webserver; this
  package does not maintain a second desktop-only UI or directory-picker implementation.

The directory picker is supplied through the harness `directory-picker` capability and
its platform-native providers. This keeps the desktop shell and headless composition on
the same capability path.

## Runtime path

1. Electron acquires the single-instance lock and calls `bootDesktop()`.
2. `boot.ts` loads the `web` profile, applies the user layer and desktop overlays,
   then waits for the webserver to bind `127.0.0.1` on an OS-assigned port.
3. `main.ts` opens a sandboxed `BrowserWindow` at that loopback URL. The page loads
   the harness HTML, `/plugins` client bundles, `/api` RPC, and WebSocket events.
4. On quit, the shell waits for the boot promise and disposes the Cordis tree before
   exiting the Electron process.

See the [architecture diagrams](../../docs/architecture.md) for the full component map
and runtime sequence.

## Local development

Prerequisites: Node.js `^22.19 || >=24`, pnpm 11, and Git. The packaged app itself
does not require Node.js or pnpm.

```sh
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop dev
```

The headless checks do not require a display or a real API key:

```sh
pnpm --filter @deepseek-ai/dsh-desktop typecheck
pnpm --filter @deepseek-ai/dsh-desktop smoke
pnpm --filter @deepseek-ai/dsh-desktop test:policy
pnpm --filter @deepseek-ai/dsh-desktop test:lifecycle
```

`smoke` boots the composition against a temporary Harness home and verifies the GUI
boot manifest, a client bundle under `/plugins`, and the `host.describe` RPC.

## Packaging

```sh
pnpm --filter @deepseek-ai/dsh-desktop dist:mac
pnpm --filter @deepseek-ai/dsh-desktop dist:win
pnpm --filter @deepseek-ai/dsh-desktop dist:linux
```

Artifacts are written to `apps/desktop/release/`. For macOS architecture-specific
packages, use `dist:mac:arm64` or `dist:mac:x64`. Universal packaging is intentionally not offered because the app includes architecture-specific native modules that cannot be safely merged.
Windows and Linux packages are best built and launched on their matching CI runners;
macOS cross-builds can produce an artifact but do not replace target-platform testing.

The builder unpacks `node_modules/**` because the harness profile fallback uses
filesystem links that cannot traverse an `app.asar` file. Agent presets are shipped in
`config/agent-presets`. Release signing, notarization, CI targets, and cleanup guidance
are documented in [docs/building.md](../../docs/building.md).

## User data and security boundary

Harness data is stored in `~/.dsh`, shared with the `dsh` CLI. Electron shell state is
kept in Electron's `userData` directory. The renderer uses context isolation, sandboxing,
and no Node integration; navigation is restricted to the booted loopback origin, while
allowed external links open in the system browser. See [docs/quality.md](../../docs/quality.md)
for the verification evidence and the limits of the memory-leak checks.

## Source layout

| Path | Responsibility |
|---|---|
| `src/main.ts` | Electron process, window, menu, lifecycle, and diagnostics |
| `src/boot.ts` | Harness profile composition, overlays, and teardown |
| `src/preload.cts` | Sandboxed preload surface |
| `src/permissions.ts` | Advisory OS capability checks and reminders |
| `src/window-policy.ts` | Loopback navigation and external URL policy |
| `tests/` | Smoke, lifecycle, and navigation-policy checks |
| `electron-builder.yml` | Platform targets and packaged-file rules |
