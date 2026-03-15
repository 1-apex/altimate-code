import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Directories and file patterns to scan for web documentation. */
const DOC_TARGETS = [
  { dir: "packages/web/src/content/docs", extensions: [".mdx", ".md"] },
  { dir: "packages/web/src/components", extensions: [".astro"] },
]

/** Single-file targets. */
const SINGLE_FILES = ["packages/web/config.mjs"]

/** Replacements for web documentation files. */
const DOC_REPLACEMENTS: Array<{
  match: RegExp
  replacement: string
  description: string
}> = [
  // CLI commands (binary is renamed)
  { match: /opencode serve/g, replacement: "altimate-code serve", description: "CLI command: serve" },
  { match: /opencode auth login/g, replacement: "altimate-code auth login", description: "CLI command: auth login" },
  { match: /opencode auth logout/g, replacement: "altimate-code auth logout", description: "CLI command: auth logout" },
  { match: /opencode auth/g, replacement: "altimate-code auth", description: "CLI command: auth" },
  { match: /opencode config/g, replacement: "altimate-code config", description: "CLI command: config" },
  { match: /opencode init/g, replacement: "altimate-code init", description: "CLI command: init" },
  // Install commands in code blocks
  { match: /npm install -g opencode/g, replacement: "npm install -g @altimateai/altimate-code", description: "npm install command" },
  { match: /npx opencode/g, replacement: "npx @altimateai/altimate-code", description: "npx command" },
  { match: /brew install opencode/g, replacement: "brew install altimate-code", description: "brew install command" },
  // Product names (more specific first)
  { match: /OpenCode Desktop/g, replacement: "Altimate Code Desktop", description: "product name (Desktop)" },
  { match: /OpenCode/g, replacement: "Altimate Code", description: "product name" },
  // URLs
  { match: /opencode\.ai/g, replacement: "altimate.ai", description: "website URL" },
  // GitHub references
  { match: /anomalyco\/opencode/g, replacement: "AltimateAI/altimate-code", description: "GitHub owner/repo" },
]

/** Recursively find files with given extensions in a directory. */
function findFiles(dir: string, extensions: string[]): string[] {
  if (!fs.existsSync(dir)) return []

  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findFiles(fullPath, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath)
    }
  }

  return results
}

/** Transform a single documentation file. */
async function transformDocFile(
  absPath: string,
  relPath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  let content = fs.readFileSync(absPath, "utf-8")
  const changes: Change[] = []

  for (const r of DOC_REPLACEMENTS) {
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

/** Transform all web documentation files. */
export async function transformWebDocs(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const root = repoRoot()
  const reports: FileReport[] = []

  // Process directory targets
  for (const target of DOC_TARGETS) {
    const dirPath = path.join(root, target.dir)
    const files = findFiles(dirPath, target.extensions)

    for (const absPath of files) {
      const relPath = path.relative(root, absPath)
      reports.push(await transformDocFile(absPath, relPath, options))
    }
  }

  // Process single-file targets
  for (const relPath of SINGLE_FILES) {
    const absPath = path.join(root, relPath)
    reports.push(await transformDocFile(absPath, relPath, options))
  }

  return reports
}
