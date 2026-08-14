/**
 * Electron main: owns the app window and lifecycle and boots the harness
 * through {@link bootDesktop}, running the harness's own native directory picker.
 * The renderer is the harness's own web GUI served over the loopback
 * webserver, so every dsh web feature (sessions, tools, the workspace/folder
 * flow, model settings) behaves exactly as in the browser.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { bootDesktop, desktopOverlayPatches, type DesktopBoot } from './boot.ts'
import { detectPermissionIssues, remindPermissionIssues } from './permissions.ts'
import { isAllowedExternalUrl, isSameOrigin } from './window-policy.ts'

/** The single app window; closed means the shell is showing no GUI. */
let mainWindow: BrowserWindow | undefined

/** The booted harness; set once startup settles and cleared on teardown. */
let harness: DesktopBoot | undefined

/** Set before shutdown starts so an in-flight boot cannot create a new window. */
const lifecycle = { quitRequested: false }

/** Preload script path, emitted beside this module as CommonJS (sandboxed preloads cannot be ESM). */
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url))

/** A single append chain prevents a burst of renderer errors from retaining open writes. */
let diagnosticLog = Promise.resolve()

/**
 * Append a bounded diagnostic line inside Electron's userData, so boot
 * failures remain readable without a terminal and writes stay ordered.
 * @param message - the diagnostic message.
 * @returns a promise that settles after this line has been attempted.
 */
function log(message: string): Promise<void> {
  const bounded = message.length > 8000 ? `${message.slice(0, 8000)}…` : message
  diagnosticLog = diagnosticLog.then(async () => {
    try {
      const file = join(app.getPath('userData'), 'dsh-desktop.log')
      await appendFile(file, `${new Date().toISOString()} ${bounded}\n`)
    } catch (error) {
      console.error('[dsh-desktop]', bounded, error instanceof Error ? error.message : '')
    }
  })
  return diagnosticLog
}

/** Open a browser/mail URL only after applying the renderer boundary policy. */
function openExternalUrl(target: string): void {
  if (!isAllowedExternalUrl(target)) {
    void log(`blocked external URL: ${target.slice(0, 500)}`)
    return
  }
  void shell.openExternal(target).catch((error: unknown) => {
    void log(`openExternal failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * Create the main window over the harness GUI URL.
 * @param url - the loopback URL the harness webserver bound.
 * @returns the created window.
 */
function createWindow(url: string): BrowserWindow {
  const origin = new URL(url).origin
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
    openExternalUrl(target)
    return { action: 'deny' }
  })
  // Keep the renderer on the booted loopback origin. A plugin or injected page
  // must not be able to turn the BrowserWindow into a general-purpose browser.
  const handleNavigation = (event: Electron.Event, target: string): void => {
    if (isSameOrigin(target, origin)) return
    event.preventDefault()
    openExternalUrl(target)
  }
  win.webContents.on('will-navigate', handleNavigation)
  win.webContents.on('will-redirect', handleNavigation)
  // The desktop UI has no webview surface; prevent a plugin from creating a
  // second renderer with a weaker navigation policy.
  win.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    void log(`did-fail-load ${code} ${description}`)
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
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
          click: () => { openExternalUrl(url) },
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
      overlays: desktopOverlayPatches(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : ''
    await log(`boot failed: ${message}\n${stack}`)
    dialog.showErrorBox('DeepSeek Harness failed to start', message)
    app.quit()
    return
  }
  if (lifecycle.quitRequested) return
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
      const screenshotMode = (env.DSH_DESKTOP_SCREENSHOT ?? '') !== ''
      if (lifecycle.quitRequested) return
      if (issues.length > 0 && !screenshotMode) {
        await remindPermissionIssues(issues, join(app.getPath('userData'), 'permission-dismissals.json'))
      }
    } catch (error) {
      await log(`permission check failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
  const screenshot = env.DSH_DESKTOP_SCREENSHOT ?? ''
  if (screenshot !== '') {
    const screenshotWindow = mainWindow
    screenshotWindow.webContents.once('did-finish-load', () => {
      void (async () => {
        try {
          // Let the shell kernel settle and the UI paint before capturing.
          await new Promise(resolve => setTimeout(resolve, 15000))
          if (screenshotWindow.isDestroyed()) return
          const image = await screenshotWindow.webContents.capturePage()
          await writeFile(screenshot, image.toPNG())
          const dom = await (screenshotWindow.webContents.executeJavaScript(`({
            title: document.title,
            rootChildren: document.getElementById('root')?.childElementCount ?? -1,
            textLength: (document.body?.innerText ?? '').length,
            text: (document.body?.innerText ?? '').slice(0, 300),
            bootIds: (() => {
              const b = window.__DSH_BOOT__
              return b && Array.isArray(b.entries) ? b.entries.map(e => e.id).join('|') : 'NO_BOOT'
            })(),
            hasBoot: typeof window.__DSH_BOOT__ !== 'undefined',
          })`) as Promise<unknown>)
          await log(`dom: ${JSON.stringify(dom)}`)
        } catch (error) {
          await log(`dom capture failed: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
          app.quit()
        }
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

  /** Startup is tracked so a quit during plugin activation waits for cleanup. */
  let startup: Promise<void> | undefined
  let tearingDown = false

  void app.whenReady().then(() => {
    startup = start()
    void startup.catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      await log(`startup failed: ${error instanceof Error ? error.stack ?? message : message}`)
      if (!lifecycle.quitRequested) {
        dialog.showErrorBox('DeepSeek Harness failed to start', message)
        app.quit()
      }
    })
  })

  process.on('uncaughtException', (error) => { void log(`uncaughtException: ${error.stack ?? error.message}`) })
  process.on('unhandledRejection', (reason) => { void log(`unhandledRejection: ${String(reason)}`) })

  // Teardown: wait for startup to settle, then dispose the harness tree before
  // the app exits. This also covers a user closing the window during boot.
  app.on('before-quit', (event) => {
    if (tearingDown) return
    tearingDown = true
    lifecycle.quitRequested = true
    event.preventDefault()
    void (async () => {
      try {
        try { await startup } catch (error) {
          await log(`startup cleanup observed: ${error instanceof Error ? error.message : String(error)}`)
        }
        await harness?.dispose()
        harness = undefined
      } catch (error) {
        await log(`harness dispose failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        app.exit(0)
      }
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
