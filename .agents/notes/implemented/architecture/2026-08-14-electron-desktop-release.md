# Electron desktop release foundation

Date: 2026-08-14

## Decision

The desktop application keeps the harness web frontend on a loopback HTTP server and boots the same `dsh-app-boot` profile in the Electron main process. The renderer remains sandboxed and receives no Node or arbitrary IPC surface.

The Electron shell now owns explicit navigation and teardown policies: only the booted origin may remain in the BrowserWindow, external links are limited to `http`, `https`, and `mailto`, webviews are denied, and quit waits for startup settlement and harness disposal.

The release artifact unpacks the complete dependency closure because Harness profile fallback uses filesystem symlinks that cannot traverse an asar archive. Platform-specific native modules remain architecture-specific for macOS universal packaging.

## Verification

The release baseline includes policy regression tests, repeated boot/dispose lifecycle tests, a loopback HTTP/API smoke test, full workspace build, production dependency audit, Mermaid and Markdown validation, and a packaged macOS arm64 launch with a rendered screenshot.

Short tests cannot prove that Chromium, native modules, or every third-party plugin has zero long-duration memory growth. The release checklist therefore requires 30–60 minute per-platform sessions with process RSS monitoring before signed public distribution.

## Release operation

Pushing a `v*` tag runs the cross-platform GitHub Actions matrix and publishes its installers to GitHub Releases. Signing and notarization are supplied through repository secrets; local builds remain suitable for internal acceptance but are not presented as trusted public installers.
