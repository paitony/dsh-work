/**
 * Electron backend of the directory-picker seam: registers `ctx.directoryPicker`
 * with the `native` capability, opening Electron's own OS directory chooser
 * (`dialog.showOpenDialog`) instead of spawning the osascript/zenity child the
 * stock native backend uses. Loaded only inside Electron's main process; the
 * headless smoke test never imports this module.
 *
 * The overlay disables the web-app bundle's auto chooser row and mounts this
 * backend in its place; the client surface the auto chooser also mounted is
 * mounted here, so the workspace folder flow keeps its picking affordance.
 * @module @deepseek-ai/dsh-desktop/picker
 */

import { dialog } from 'electron'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'

/** Stable Cordis plugin name. */
export const name = 'desktop-picker'

/** The directory-picker row the web-app bundle mounts (directory-picker-auto); the overlay disables it. */
const AUTO_PICKER_ROW_ID = 'directory-picker'

/** The client surface row the auto chooser also mounts; Electron mounts it so
 * the workspace flow keeps its picking affordance. */
const NATIVE_SURFACE_PACKAGE = '@deepseek-ai/dsh-client-ui-directory-picker-native'

/**
 * The picker swap overlay: disable the auto chooser and mount the Electron
 * backend in its place.
 * @returns patches applied by the Electron shell after the desktop defaults.
 */
export function electronPickerOverlay(): PatchOptions[] {
  return [
    { id: AUTO_PICKER_ROW_ID, disabled: true },
    { insert: [{ id: 'desktop-picker', name: '@deepseek-ai/dsh-desktop/picker', inject: ['loader'] }] },
  ]
}

/** The `ctx.directoryPicker` Electron implementation (stable capability object per service life). */
export class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: async (signal) => {
      // Electron has no programmatic dialog close, so an aborted caller
      // resolves null immediately while the OS dialog stays up; the user's
      // eventual choice is discarded. The seam's abort contract is best
      // effort on this backend for that reason.
      if (signal.aborted) return null
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Directory',
        properties: ['openDirectory', 'createDirectory'],
      })
      const first = result.canceled ? undefined : result.filePaths[0]
      return first ?? null
    },
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}

/**
 * Mount the Electron picker and the workspace surface it drives.
 * @param ctx - plugin context carrying the loader service.
 */
export async function apply(ctx: Context): Promise<void> {
  ctx.plugin(ElectronDirectoryPicker)
  // Root-tree create: the Loader root is in-memory (write() is a no-op), so
  // the mounted surface row can never be persisted back into a config file.
  await ctx.effect(async () => {
    const id = await ctx.loader.create({ name: NATIVE_SURFACE_PACKAGE })
    return async () => {
      if (ctx.loader.store[id] === undefined) return
      await ctx.loader.remove(id)
    }
  }, 'desktop-picker: surface entry')
}
