/** Validate the documentation surface that this desktop repository publishes. */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

const documentationFiles = [
  'README.md',
  'README.en.md',
  'docs/architecture.md',
  'docs/building.md',
  'docs/quality.md',
  'docs/screenshots.md',
  'apps/desktop/README.md',
  'apps/desktop/README.zh.md',
] as const

const screenshotFiles = [
  'assets/desktop-main-window.png',
  'assets/screenshots/desktop-home.png',
  'assets/screenshots/desktop-model-selector.png',
  'assets/screenshots/desktop-settings-agent-presets.png',
  'assets/screenshots/desktop-settings-general.png',
  'assets/screenshots/desktop-settings-models.png',
  'assets/screenshots/desktop-settings-plugins.png',
] as const

const requiredText: Readonly<Record<string, readonly string[]>> = {
  'README.md': ['docs/architecture.md', 'docs/building.md', 'docs/quality.md', 'docs/screenshots.md', 'GitHub Releases'],
  'README.en.md': ['docs/architecture.md', 'docs/building.md', 'docs/quality.md', 'docs/screenshots.md', 'GitHub Releases'],
  'docs/architecture.md': ['flowchart TB', 'sequenceDiagram', 'apps/desktop/src/main.ts'],
  'docs/building.md': ['.github/workflows/build.yml', '.github/workflows/release.yml', 'dist:mac:arm64', 'dist:win'],
  'docs/quality.md': ['contextIsolation', 'test:lifecycle', 'smoke', '30–60'],
  'docs/screenshots.md': screenshotFiles,
}

const staleProjectReferences = [
  /(?:^|[/(])website\//,
  /docs\/(?:user|subsystems|i18n)\//,
] as const

interface LinkReference {
  target: string
  line: number
}

/** Read a repository-relative file as UTF-8 text. */
function readProjectFile(path: string): string {
  return readFileSync(resolve(root, path), 'utf8')
}

/** Extract Markdown inline links and images outside fenced code blocks. */
function localLinkReferences(markdown: string): LinkReference[] {
  const references: LinkReference[] = []
  let inFence = false
  for (const [index, line] of markdown.split('\n').entries()) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const pattern = /!?(?:\[[^\]]*\])\((?:<([^>]+)>|([^\s)]+))/g
    for (const match of line.matchAll(pattern)) {
      const target = match[1] ?? match[2]
      if (target === undefined || isExternalTarget(target)) continue
      references.push({ target, line: index + 1 })
    }
  }
  return references
}

/** Decide whether a Markdown target is outside the repository. */
function isExternalTarget(target: string): boolean {
  return target.startsWith('#')
    || target.startsWith('//')
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
}

/** Resolve a local Markdown target without its query or fragment. */
function targetPath(target: string): string {
  return target.split(/[?#]/, 1)[0] ?? ''
}

/** Check one document for missing local targets and stale upstream routes. */
function checkDocument(path: string, errors: string[]): void {
  const markdown = readProjectFile(path)
  for (const pattern of staleProjectReferences) {
    if (pattern.test(markdown)) errors.push(`${path}: contains stale project reference ${pattern}`)
  }
  for (const reference of localLinkReferences(markdown)) {
    const relativeTarget = targetPath(reference.target)
    if (relativeTarget === '') continue
    const absoluteTarget = resolve(root, dirname(path), relativeTarget)
    if (!existsSync(absoluteTarget)) {
      errors.push(`${path}:${reference.line}: missing local target ${JSON.stringify(reference.target)}`)
    }
  }
}

/** Run all project documentation checks and report every failure together. */
function main(): number {
  const errors: string[] = []
  for (const path of documentationFiles) {
    if (!existsSync(resolve(root, path))) {
      errors.push(`missing required document ${path}`)
      continue
    }
    const markdown = readProjectFile(path)
    checkDocument(path, errors)
    for (const required of requiredText[path] ?? []) {
      if (!markdown.includes(required)) errors.push(`${path}: missing required text ${JSON.stringify(required)}`)
    }
  }
  for (const path of screenshotFiles) {
    if (!existsSync(resolve(root, path))) errors.push(`missing screenshot asset ${path}`)
  }
  if (errors.length > 0) {
    console.error(`check-project-docs: ${errors.length} issue(s):`)
    for (const error of errors) console.error(`- ${error}`)
    return 1
  }
  console.log(`check-project-docs: ${documentationFiles.length} documents, ${screenshotFiles.length} screenshot assets, all checks passed.`)
  return 0
}

if (import.meta.main) process.exitCode = main()
