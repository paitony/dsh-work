/**
 * Headless smoke test for the desktop composition: boots the same harness the
 * Electron shell boots (web profile + desktop overlays, minus the Electron
 * picker swap) under plain Node with an isolated Harness home, then asserts
 * the GUI contract end to end: the SPA index carries window.__DSH_BOOT__, a
 * client bundle serves from /plugins, and the /api gateway answers a real
 * unary RPC. Run with: pnpm --filter @deepseek-ai/dsh-desktop smoke
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootDesktop, desktopOverlayPatches } from '../src/boot.ts'

// The composition is what ships; boot it headlessly against a throwaway home.
process.env.DSH_TELEMETRY_DISABLED = '1'

const home = await mkdtemp(join(tmpdir(), 'dsh-desktop-smoke-'))
let failed = false
try {
  const boot = await bootDesktop({ overlays: desktopOverlayPatches(), home })
  try {
    const index = await fetch(boot.url)
    const html = await index.text()
    if (!index.ok || !html.includes('__DSH_BOOT__')) {
      throw new Error(`index does not carry the boot manifest (HTTP ${index.status})`)
    }

    const manifest = JSON.parse(
      /<script>window\.__DSH_BOOT__ = (.*?)<\/script>/s.exec(html)?.[1] ?? '{}',
    ) as { entries?: { id: string; url: string }[] }
    const bundle = manifest.entries?.find(entry => entry.url.includes('/plugins/'))
    if (bundle === undefined) throw new Error('boot manifest carries no plugin bundle url')
    const bundleRes = await fetch(new URL(bundle.url, boot.url))
    if (!bundleRes.ok) throw new Error(`client bundle ${bundle.id} failed: HTTP ${bundleRes.status}`)

    const rpc = await fetch(new URL('/api/host.describe', boot.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'smoke-1', method: 'host.describe', payload: {} }),
    })
    const envelope = await rpc.json() as { result?: { ok?: boolean } }
    if (envelope.result?.ok !== true) {
      throw new Error(`host.describe did not answer ok: ${JSON.stringify(envelope).slice(0, 200)}`)
    }

    console.log(`smoke ok: ${boot.url} | index+manifest | ${bundle.id} bundle | host.describe rpc`)
  } finally {
    await boot.dispose()
  }
} catch (error) {
  failed = true
  console.error('smoke failed:', error instanceof Error ? error.message : error)
} finally {
  await rm(home, { recursive: true, force: true })
}
if (failed) process.exitCode = 1
