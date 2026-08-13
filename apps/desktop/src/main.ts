/**
 * Electron main: owns the app window and lifecycle and boots the harness
 * through {@link bootDesktop}, swapping in the Electron directory picker.
 * The renderer is the harness's own web GUI served over the loopback
 * webserver, so every dsh web feature (sessions, tools, the workspace/folder
 * flow, model settings) behaves exactly as in the browser.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { bootDesktop, desktopOverlayPatches, type DesktopBoot } from './boot.ts'
import { electronPickerOverlay } from './picker.ts'
import { detectPermissionIssues, remindPermissionIssues } from './permissions.ts'

/** The single app window; closed means the shell is showing no GUI. */
let mainWindow: BrowserWindow | undefined

/** The booted harness; set once startup settles and cleared on teardown. */
let harness: DesktopBoot | undefined

/** Preload script path, emitted beside this module as CommonJS (sandboxed preloads cannot be ESM). */
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))
/** Diagnostic log inside Electron's userData, so boot failures are readable without a terminal. */
async function log(message: string): Promise<void> {
  // Resolved lazily: app.getPath('userData') may be unavailable at module scope.
  try {
    const file = join(app.getPath('userData'), 'dsh-desktop.log')
    await appendFile(file, `${new Date().toISOString()} ${message}\n`)
  } catch (error) {
    console.error('[dsh-desktop]', message, error instanceof Error ? error.message : '')
  }
}


/**
 * Create the main window over the harness GUI URL.
 * @param url - the loopback URL the harness webserver bound.
 * @returns the created window.
 */
function createWindow(url: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // Outbound links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    void log(`did-fail-load ${code} ${description}`)
  })
  win.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    void log(`renderer console: ${message} (${sourceId}:${line})`)
  })
  void win.loadURL(url)
  return win
}

/**
 * The app menu: standard roles plus a File menu with the harness GUI's URL.
 * @param url - the loopback URL for the "Open in Browser" item.
 */
function buildMenu(url: string): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...isMac ? [{ role: 'appMenu' as const }] : [],
    {
      label: 'File',
      submenu: [
        {
          label: 'Open in Browser',
          click: () => { void shell.openExternal(url) },
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Boot the harness, create the window, and — when DSH_DESKTOP_SCREENSHOT is
 * set — capture the rendered GUI to a PNG and quit (verification mode).
 */
async function start(): Promise<void> {
  await log('boot start')
  try {
    harness = await bootDesktop({
      overlays: [...desktopOverlayPatches(), ...electronPickerOverlay()],
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : ''
    await log(`boot failed: ${message}\n${stack}`)
    dialog.showErrorBox('DeepSeek Harness failed to start', message)
    app.quit()
    return
  }
  await log(`boot ok: ${harness.url}`)
  buildMenu(harness.url)
  mainWindow = createWindow(harness.url)
  // Advisory OS-capability check: reports TCC/Seatbelt/PowerShell gaps without
  // blocking startup, and reminds once per issue.
  void (async () => {
    try {
      const issues = await detectPermissionIssues()
      await log(`permissions: ${issues.length === 0 ? 'ok' : issues.map(i => i.id).join(',')}`)
      // Screenshot verification mode must not block on a modal reminder.
      const screenshot = process.env.DSH_DESKTOP_SCREENSHOT
      if (issues.length > 0 && (screenshot === undefined || screenshot === '')) {
        await remindPermissionIssues(issues, join(app.getPath('userData'), 'permission-dismissals.json'))
      }
    } catch (error) {
      await log(`permission check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  const screenshot = process.env.DSH_DESKTOP_SCREENSHOT
  if (screenshot !== undefined && screenshot !== '') {
    mainWindow.webContents.once('did-finish-load', () => {
      void (async () => {
        // Let the shell kernel settle and the UI paint before capturing.
        await new Promise(resolve => setTimeout(resolve, 15000))
        const image = await mainWindow?.webContents.capturePage()
        if (image !== undefined) await writeFile(screenshot, image.toPNG())
        try {
          const dom = await mainWindow?.webContents.executeJavaScript(`({
            title: document.title,
            rootChildren: document.getElementById('root')?.childElementCount ?? -1,
            textLength: (document.body?.innerText ?? '').length,
            text: (document.body?.innerText ?? '').slice(0, 300),
            bootIds: (() => {
              const b = window.__DSH_BOOT__
              return b && Array.isArray(b.entries) ? b.entries.map(e => e.id).join('|') : 'NO_BOOT'
            })(),
            hasBoot: typeof window.__DSH_BOOT__ !== 'undefined',
          })`)
          await log(`dom: ${JSON.stringify(dom)}`)
        } catch (error) {
          await log(`dom capture failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        app.quit()
      })()
    })
  }
}

// A second instance just focuses the existing window (single-user desktop).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => { void start() })

  process.on('uncaughtException', (error) => { void log(`uncaughtException: ${error.stack ?? error.message}`) })
  process.on('unhandledRejection', (reason) => { void log(`unhandledRejection: ${String(reason)}`) })

  // Teardown: dispose the harness tree before the app exits, so sessions and
  // background jobs quiesce cleanly. One quit pass only — the disposal
  // promise drives app.exit once it settles.
  let tearingDown = false
  app.on('before-quit', (event) => {
    if (tearingDown) return
    tearingDown = true
    event.preventDefault()
    void (async () => {
      try { await harness?.dispose() } finally { app.exit(0) }
    })()
  })

  app.on('window-all-closed', () => {
    // macOS convention: keep the app (and the harness) alive until Cmd+Q.
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('activate', () => {
    if (mainWindow === undefined && harness !== undefined) {
      mainWindow = createWindow(harness.url)
    }
  })
}