# Project documentation surface cleanup

Date: 2026-08-14

## Decision

The desktop fork publishes a small, maintained documentation surface: the root READMEs, the desktop README pair, architecture, build/release, quality, and runtime screenshots. The unused VitePress projection and its site-only scripts are removed because their manifest pointed to upstream documents that are not present in this repository.

`doc-sync` now checks the documents and screenshot assets that users can actually follow, including local links, required architecture and release statements, Mermaid diagrams, Markdown wrapping, public repository references, and documentation budgets. It does not claim to validate a removed documentation site or generate placeholder subsystem pages.

## Verification

The cleanup was verified with `pnpm run doc-sync`, `pnpm run build`, `pnpm run knip`, desktop typecheck, desktop policy/lifecycle/smoke checks, the gate and notices tests, and `pnpm run verify-third-party-notices`.
