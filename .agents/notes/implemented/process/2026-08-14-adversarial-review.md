# Desktop adversarial review follow-up

Date: 2026-08-14

## Decision

The desktop lifecycle regression test disables telemetry and drains each loopback response before disposing the harness tree. This keeps repeated boot/dispose checks isolated from user configuration and avoids leaving response bodies attached to the test process.

The release workflow uses read-only repository permissions for packaging, grants write access only to the publish job, serializes releases per tag, bounds job duration, and pins the two third-party actions that handle package setup and release publication to immutable commits.

## Verification

The repository documents a gallery of real Electron runtime states. The packaged-window screenshot and the renderer-state screenshots are kept under `assets/` and linked from the root README, desktop README files, and the quality record.
