/**
 * Startup capability detection for OS permissions the harness needs.
 *
 * macOS: reading/writing the TCC-protected user directories (Desktop,
 * Documents, Downloads) requires Full Disk Access in System Settings, and the
 * Seatbelt sandbox runner (sandbox-exec) is deprecated and absent on some
 * macOS releases — the harness's bash tool fails closed without it. Windows:
 * the PowerShell tool needs a pwsh or Windows PowerShell install.
 *
 * Detection is advisory only: it runs after the window is up, reports what it
 * found, and never blocks startup. Results are logged and surfaced once via a
 * message box with a link into the relevant System Settings pane.
 * @module @deepseek-ai/dsh-desktop/permissions
 */

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { dialog, shell } from 'electron'

/** One detected capability gap, with the fix the reminder links to. */
export interface PermissionIssue {
  /** Stable id (used for the one-time reminder key). */
  id: string
  /** Short headline. */
  title: string
  /** Operator-facing explanation and fix path. */
  detail: string
  /** A settings URL to open, or undefined when no single pane applies. */
  settingsUrl?: string
}

/** TCC-protected user directories on macOS; each is probed only when present. */
const MAC_TCC_DIRECTORIES = ['Desktop', 'Documents', 'Downloads'] as const

/**
 * Probe whether a directory is writable without OS elevation. On macOS an
 * un-authorized TCC directory either rejects the write or silently reads as
 * empty; a write probe is the unambiguous signal.
 * @param dir - the directory to probe.
 * @returns true when a probe file could be created and removed.
 */
function probeWritable(dir: string): boolean {
  try {
    const probe = join(dir, `.dsh-perm-probe-${process.pid}`)
    writeFileSync(probe, '')
    rmSync(probe)
    return true
  } catch {
    return false
  }
}

/**
 * Probe the Seatbelt runner: the harness's bash tool fails closed when
 * sandbox-exec cannot confine a command.
 * @returns true when sandbox-exec runs a trivial profile.
 */
function probeSeatbelt(): boolean {
  try {
    execFileSync('/usr/bin/sandbox-exec', ['-p', '(version 1) (allow default)', '--', '/usr/bin/true'], {
      timeout: 5000,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Probe whether a pwsh (or Windows PowerShell) executable is on PATH.
 * @returns the resolved executable name, or undefined.
 */
async function probePowerShell(): Promise<string | undefined> {
  for (const name of ['pwsh', 'powershell.exe', 'powershell']) {
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(name, ['-NoProfile', '-Command', '$true'], { timeout: 8000 }, (error) => {
          if (error === null) resolve()
          else reject(error)
        })
      })
      return name
    } catch { /* try the next name */ }
  }
  return undefined
}

/**
 * Detect capability gaps for the current platform.
 * @returns the issues found (empty when nothing is missing).
 */
export async function detectPermissionIssues(): Promise<PermissionIssue[]> {
  const issues: PermissionIssue[] = []
  if (process.platform === 'darwin') {
    // TCC: Desktop/Documents/Downloads are protected; the harness's fs and
    // bash tools cannot touch them without Full Disk Access.
    const blocked: string[] = []
    for (const name of MAC_TCC_DIRECTORIES) {
      const dir = join(homedir(), name)
      if (existsSync(dir) && !probeWritable(dir)) blocked.push(name)
    }
    if (blocked.length > 0) {
      issues.push({
        id: 'mac-full-disk-access',
        title: '文件夹访问受限',
        detail: `DeepSeek Harness 无法写入「${blocked.join('、')}」。如需在这些目录下工作，请在系统设置中为 DeepSeek Harness 开启「完全磁盘访问」权限。`,
        settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
      })
    }
    if (!probeSeatbelt()) {
      issues.push({
        id: 'mac-seatbelt-unavailable',
        detail: '当前 macOS 未提供 sandbox-exec，安全沙箱不可用，终端命令工具（bash）将被禁用。可在设置中切换权限模式后重试。',
        title: '安全沙箱不可用',
      })
    }
  }
  if (process.platform === 'win32') {
    if (await probePowerShell() === undefined) {
      issues.push({
        id: 'win-powershell-missing',
        title: '未检测到 PowerShell',
        detail: 'PowerShell 工具需要 PowerShell 7（pwsh）或 Windows 自带 PowerShell 5.1。请安装后重启应用。',
      })
    }
  }
  return issues
}

/**
 * Show the first-run permission reminder once per detected issue id. The
 * acknowledgement is remembered in Electron's userData settings file.
 * @param issues - the issues to surface.
 * @param settingsFile - the JSON file remembering dismissed ids.
 * @returns the ids the user was reminded about.
 */
export async function remindPermissionIssues(
  issues: PermissionIssue[],
  settingsFile: string,
): Promise<string[]> {
  const shown: string[] = []
  const dismissed = new Set<string>(loadDismissed(settingsFile))
  for (const issue of issues) {
    if (dismissed.has(issue.id)) continue
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: issue.title,
      message: issue.title,
      detail: issue.detail,
      buttons: issue.settingsUrl === undefined ? ['知道了'] : ['打开系统设置', '知道了'],
      defaultId: issue.settingsUrl === undefined ? 0 : 0,
      cancelId: issue.settingsUrl === undefined ? 0 : 1,
      noLink: true,
    })
    if (response === 0 && issue.settingsUrl !== undefined) {
      await shell.openExternal(issue.settingsUrl)
    }
    dismissed.add(issue.id)
    shown.push(issue.id)
  }
  try { writeFileSync(settingsFile, JSON.stringify([...dismissed], null, 2)) } catch { /* best effort */ }
  return shown
}

/** Read the previously dismissed issue ids (best effort). */
function loadDismissed(settingsFile: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(settingsFile, 'utf8')) as unknown
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}