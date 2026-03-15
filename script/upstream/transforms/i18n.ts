import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Glob patterns for i18n translation files. */
const I18N_PATTERNS = [
  "packages/app/src/i18n",
  "packages/desktop/src/i18n",
  "packages/desktop-electron/src/renderer/i18n",
  "packages/console/app/src/i18n",
  "packages/ui/src/i18n",
]

/** String replacements to apply in translation files. */
const TRANSLATION_REPLACEMENTS: Array<{
  match: RegExp
  replacement: string
  description: string
}> = [
  {
    match: /OpenCode Desktop/g,
    replacement: "Altimate Code Desktop",
    description: '"OpenCode Desktop" product name',
  },
  {
    match: /OpenCode/g,
    replacement: "Altimate Code",
    description: '"OpenCode" product name',
  },
  {
    match: /opencode\.ai/g,
    replacement: "altimate.ai",
    description: "URL reference",
  },
]

/** Find all TypeScript files in an i18n directory. */
function findI18nFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return []

  const files: string[] = []
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(path.join(dirPath, entry.name))
    }
  }
  return files
}

/** Transform a single i18n translation file. */
async function transformI18nFile(
  absPath: string,
  relPath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  let content = fs.readFileSync(absPath, "utf-8")
  const changes: Change[] = []

  // Apply replacements in order (more specific first — "OpenCode Desktop" before "OpenCode")
  for (const r of TRANSLATION_REPLACEMENTS) {
    const before = content
    content = content.replace(r.match, r.replacement)
    if (content !== before) {
      changes.push({ description: r.description })
    }
  }

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, content, "utf-8")
  }

  return { filePath: relPath, applied: !options?.dryRun, changes }
}

/** Transform all i18n translation files. */
export async function transformI18n(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const root = repoRoot()
  const reports: FileReport[] = []

  for (const pattern of I18N_PATTERNS) {
    const dirPath = path.join(root, pattern)
    const files = findI18nFiles(dirPath)

    for (const absPath of files) {
      const relPath = path.relative(root, absPath)
      reports.push(await transformI18nFile(absPath, relPath, options))
    }
  }

  return reports
}
