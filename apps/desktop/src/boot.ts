/**
 * Electron launches with `--expose-internals` (our start/dev scripts) but
 * does not surface it in `process.execArgv`; the vendored Cordis loader
 * checks execArgv to decide whether it may require Node internal modules for
 * profile-anchored plugin resolution. Mirror the flag so the in-process boot
 * uses the internal loader under Electron. Under plain Node the flag is
 * already present (or the addon path serves), so this is a no-op there.
 */
if (!process.execArgv.includes('--expose-internals')) {
  process.execArgv.push('--expose-internals')
}

/**
 * Desktop harness boot: boots the `web` profile composition (the
 * `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` bundles, the profile's
 * own `cordis.patch.yml`, the home-level layer, and launcher overlays) inside
 * the current process, reusing the same `@deepseek-ai/dsh-app-boot` machinery
 * the `dsh` CLI uses. Desktop overlays bind the webserver to a loopback
 * OS-assigned port and suppress the URL line; everything else — the browser
 * GUI, the /api gateway, the tool roster, the workspace/folder flow — is
 * exactly the `dsh web` composition.
 *
 * This module is deliberately Electron-free: the Electron shell (`main.ts`)
 * supplies the desktop-specific pieces (the directory-picker capability via the harness's native backend),
 * and the same composition can be booted headlessly under plain Node for the
 * smoke test.
 * @module @deepseek-ai/dsh-desktop/boot
 */

import {
  existsSync, readdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  PROFILES_DIR,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-host-webserver'

/**
 * The desktop app's own manifest anchor. The source layout sits one level
 * under apps/desktop (../package.json), while the tsc emit lives two levels
 * down under lib/types/ — probe both so the same module works from src/ and
 * from the built tree.
 */
export const INSTALL_ANCHOR = (() => {
  const source = fileURLToPath(new URL('../package.json', import.meta.url))
  return existsSync(source) ? source : fileURLToPath(new URL('../../package.json', import.meta.url))
})()

/** Diagnostic prefix for profile/boot failures, mirroring the `dsh` bin's naming. */
export const BIN_NAME = 'dsh-desktop'

/** The profile the desktop shell boots — the same `web` template `dsh web` uses. */
export const DESKTOP_PROFILE = 'web'

/** The empty root entry list every profile tree patches over (identical to the CLI's root). */
const PROFILE_ROOT_CONFIG = [
  '# dsh-desktop profile root — an empty entry list. The tree is composed as patches:',
  '# each bundle in package.json\'s dsh.profile.bundles, then cordis.patch.yml, then the',
  '# desktop shell overlays. Edit cordis.patch.yml, not this file.',
  '[]',
].join('\n') + '\n'

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/**
 * Desktop overlay patches applied over the profile's user layer: bind the
 * webserver to a loopback OS-assigned port (no conflicts with a user's own
 * `dsh web` on 3080) and silence the URL line the browser shape prints.
 */
export function desktopOverlayPatches(): PatchOptions[] {
  return [
    { id: 'webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'web-runtime', config: { printUrl: false, surfaceContext: true, trustedHosts: [] } },
  ]
}

/** Options for {@link bootDesktop}. */
export interface BootDesktopOptions {
  /**
   * Extra patch overlays applied after the desktop defaults — the Electron
   * shell passes the directory-picker swap here; headless boots pass none.
   */
  overlays?: PatchOptions[]
  /** The home directory for profiles; defaults to {@link resolveDshHome}. */
  home?: string
}

/** The settled desktop boot: the live context and the teardown handle. */
export interface DesktopBoot {
  /** The booted Cordis root context. */
  ctx: Context
  /** Dispose the whole tree; resolves once every fiber quiesced. */
  dispose(): Promise<void>
  /** The canonical loopback URL of the GUI (resolved after the webserver bound). */
  url: string
  /** The resolved profile (for diagnostics). */
  profile: Profile
}

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
function telemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Rewrite profile-fallback symlinks whose targets point inside app.asar: the
 * OS cannot traverse an asar archive (it is a plain file), so resolution from
 * the profile directory through such a link fails. electron-builder unpacks
 * the @deepseek-ai closure to app.asar.unpacked/node_modules (real
 * directories); re-point every broken link there. A no-op outside packaged
 * builds (no app.asar.unpacked).
 * @param home - the Harness home.
 */
function repairPackagedFallbackLinks(home: string): void {
  const unpackedNodeModules = join(dirname(dirname(INSTALL_ANCHOR)), 'app.asar.unpacked', 'node_modules')
  if (!existsSync(unpackedNodeModules)) return
  const modulesDir = join(home, PROFILES_DIR, 'node_modules')
  const candidates: string[] = []
  for (const scope of readdirSync(modulesDir, { withFileTypes: true })) {
    if (scope.isDirectory() && scope.name.startsWith('@')) {
      for (const entry of readdirSync(join(modulesDir, scope.name), { withFileTypes: true })) {
        candidates.push(join(modulesDir, scope.name, entry.name))
      }
    } else {
      candidates.push(join(modulesDir, scope.name))
    }
  }
  for (const link of candidates) {
    let target: string
    try { target = readlinkSync(link) } catch { continue }
    if (!target.includes(`${sep}app.asar${sep}`)) continue
    const corrected = target.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`)
    if (!existsSync(corrected)) continue
    try {
      unlinkSync(link)
      symlinkSync(corrected, link)
    } catch { /* best effort: a broken link beats a failed boot */ }
  }
}

/**
 * Load the desktop profile: heal the shared module fallback, then (re)write
 * the empty root config the Loader needs as its include root. Mirrors the
 * CLI's `prepareProfile`.
 * @param home - the Harness home.
 * @returns the loaded profile.
 */
function prepareProfile(home: string): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  repairPackagedFallbackLinks(home)
  const profile = loadProfile(BIN_NAME, DESKTOP_PROFILE, INSTALL_ANCHOR, home, { userLayer: true })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/**
 * Compose the effective patch stack: bundle layers, the profile's user layer,
 * the home-level user layer, then the desktop overlays and the telemetry
 * switch.
 * @param profile - the loaded profile.
 * @param home - the Harness home.
 * @param overlays - launcher overlays in application order.
 * @returns the patch list to boot.
 */
function composePatches(profile: Profile, home: string, overlays: readonly PatchOptions[]): PatchOptions[] {
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([profile.layers.flatMap(layer => layer.patches), profile.patches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const telemetry = telemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  const composed = [...overlays]
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  // The writable root the roster appends is `dsh-agent-presets`' own, so a
  // launcher that never reaches this patch still finds a person's presets.
  if (rows.has('agent-presets')) {
    composed.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: join(dirname(INSTALL_ANCHOR), 'config', 'agent-presets'), trust: 'system' }],
      },
    })
  }
  return [
    ...profile.layers.flatMap(layer => layer.patches),
    ...profile.patches,
    ...loadOptionalPatches(BIN_NAME, join(home, PROFILE_PATCH_FILENAME)) ?? [],
    ...composed,
    ...telemetry === undefined ? [] : [telemetry],
  ]
}

/**
 * Wait for the webserver port after boot settles; the server binds during
 * activation, but an OS-assigned port may still be settling in a sibling
 * fiber — poll briefly rather than assume.
 * @param ctx - the settled context.
 * @returns the listening port.
 */
async function waitForPort(ctx: Context): Promise<number> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const port = ctx.get('webServer')?.port
    if (port !== undefined) return port
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('dsh-desktop: webServer never bound a port after boot')
}


/** Flatten nested loader failures into one readable message naming every failing entry. */
function describeBootError(error: unknown): string {
  const seen = new Set<Error>()
  const lines: string[] = []
  const walk = (err: Error, depth: number): void => {
    if (seen.has(err) || depth > 6) return
    seen.add(err)
    lines.push(`${'  '.repeat(depth)}${err.message}`)
    if (err instanceof AggregateError) {
      for (const cause of err.errors) {
        if (cause instanceof Error) walk(cause, depth + 1)
        else lines.push(`${'  '.repeat(depth + 1)}${String(cause)}`)
      }
      return
    }
    if (err.cause instanceof Error) walk(err.cause, depth + 1)
  }
  if (error instanceof Error) walk(error, 0)
  else lines.push(String(error))
  return lines.join('\n')
}

/**
 * Boot the desktop harness composition end to end.
 * @param options - overlays and home.
 * @returns the settled context, its URL, and the teardown handle.
 */
export async function bootDesktop(options: BootDesktopOptions = {}): Promise<DesktopBoot> {
  const home = options.home ?? resolveDshHome()
  const profile = prepareProfile(home)
  const patches = structuredClone(composePatches(profile, home, options.overlays ?? []))
  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const app: { current?: Context } = {}
  let ctx: Context
  try {
    ctx = await boot(BIN_NAME, rootConfig, patches, (hostCtx) => {
      app.current = hostCtx
      // Before any config-tree entry mounts, so plugins resolve all launch-time
      // environment values from the same immutable provenance snapshot.
      hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(BIN_NAME))
      // The desktop shell owns process lifetime; the exit request is wired to
      // tree disposal only (the caller decides whether to quit the app).
      provideCmdline(hostCtx, {
        args: [],
        exit: () => { void app.current?.fiber.dispose() },
      })
    })
  } catch (error) {
    throw new Error(`desktop boot failed — failing loader entries:\n${describeBootError(error)}`, { cause: error })
  }
  app.current = ctx
  const port = await waitForPort(ctx)
  const url = `http://127.0.0.1:${port}`
  return {
    ctx,
    profile,
    url,
    dispose: async () => { await ctx.fiber.dispose() },
  }
}
