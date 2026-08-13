/**
 * Sandboxed preload: exposes a minimal, read-only desktop surface to the
 * harness GUI. The web app needs nothing from the shell today; this is the
 * future seam for native desktop actions (folder reveal, app relaunch).
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('dshDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
})
