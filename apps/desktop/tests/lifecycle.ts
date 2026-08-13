/**
 * Repeated boot/dispose regression test for the desktop harness composition.
 * It exercises the same in-process tree used by Electron without requiring a
 * display or an API key.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootDesktop, desktopOverlayPatches } from '../src/boot.ts'

const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-lifecycle-'))
try {
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const boot = await bootDesktop({ overlays: desktopOverlayPatches(), home })
    try {
      const response = await fetch(boot.url)
      if (!response.ok) throw new Error(`cycle ${cycle}: GUI returned HTTP ${response.status}`)
    } finally {
      await boot.dispose()
    }
  }
  console.log('lifecycle ok: 3 boot/dispose cycles')
} finally {
  await rm(home, { recursive: true, force: true })
}
