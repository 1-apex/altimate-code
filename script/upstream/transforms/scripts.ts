import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Directory containing build/release scripts. */
const SCRIPTS_DIR = "script"

/** String replacements for build/release scripts. */
const SCRIPT_REPLACEMENTS: Array<{
  match: RegExp
  replacement: string
  description: string
}> = [
  // GitHub API URL patterns
  {
    match: /api\.github\.com\/repos\/anomalyco\/opencode/g,
    replacement: "api.github.com/repos/AltimateAI/altimate-code",
    description: "GitHub API URL",
  },
  {
    match: /github\.com\/anomalyco\/opencode/g,
    replacement: "github.com/AltimateAI/altimate-code",
    description: "GitHub URL",
  },
  // Release artifact naming
  {
    match: /opencode-v\$\{/g,
    replacement: "altimate-code-v${",
    description: "release artifact prefix (template literal)",
  },
  {
    match: /opencode-v\$/g,
    replacement: "altimate-code-v$",
    description: "release artifact prefix (shell variable)",
  },
  {
    match: /"opencode-/g,
    replacement: '"altimate-code-',
    description: "artifact name prefix",
  },
  // Bot identity strings
  {
    match: /opencode-bot/g,
    replacement: "altimate-code-bot",
    description: "bot identity",
  },
  {
    match: /opencode\[bot\]/g,
    replacement: "altimate-code[bot]",
    description: "bot identity (bracket notation)",
  },
  // Owner/repo in script strings
  {
    match: /anomalyco\/opencode/g,
    replacement: "AltimateAI/altimate-code",
    description: "owner/repo reference",
  },
]

/**
 * Patterns to EXCLUDE from transformation.
 * These are internal references that should keep the upstream naming.
 */
const EXCLUDE_PATHS = [
  "script/upstream/",  // Our own merge tooling references upstream intentionally
]

/** Find TypeScript files in the scripts directory (non-recursive into upstream). */
function findScriptFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip upstream directory — it references upstream intentionally
      if (entry.name === "upstream") continue
      results.push(...findScriptFiles(fullPath))
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".mts")) {
      results.push(fullPath)
    }
  }

  return results
}

/** Transform a single script file. */
async function transformScriptFile(
  absPath: string,
  relPath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  // Skip excluded paths
  for (const exclude of EXCLUDE_PATHS) {
    if (relPath.startsWith(exclude)) {
      return noChanges(relPath)
    }
  }

  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  let content = fs.readFileSync(absPath, "utf-8")
  const changes: Change[] = []

  for (const r of SCRIPT_REPLACEMENTS) {
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

/** Transform all build/release scripts. */
export async function transformScripts(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const root = repoRoot()
  const scriptsDir = path.join(root, SCRIPTS_DIR)
  const files = findScriptFiles(scriptsDir)
  const reports: FileReport[] = []

  for (const absPath of files) {
    const relPath = path.relative(root, absPath)
    reports.push(await transformScriptFile(absPath, relPath, options))
  }

  return reports
}
