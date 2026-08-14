/**
 * Desktop shell package root: the Electron-free boot surface. The Electron
 * pieces (main, preload, and permissions) are imported by
 * subpath so a headless consumer never loads the electron module.
 * @module @deepseek-ai/dsh-desktop
 */

export { bootDesktop, desktopOverlayPatches } from './boot.ts'
export type { BootDesktopOptions, DesktopBoot } from './boot.ts'
