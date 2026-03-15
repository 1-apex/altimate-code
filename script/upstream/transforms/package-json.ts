import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** The main CLI package.json that gets special bin/name treatment. */
const MAIN_PACKAGE = "packages/opencode/package.json"

/** Fields to transform across all package.json files. */
const REPO_TRANSFORMS: Array<{
  path: string[]
  match: string | RegExp
  replacement: string
  description: string
}> = [
  {
    path: ["repository", "url"],
    match: /anomalyco\/opencode/g,
    replacement: "AltimateAI/altimate-code",
    description: "repository.url owner/repo",
  },
  {
    path: ["homepage"],
    match: /opencode\.ai/g,
    replacement: "altimate.ai",
    description: "homepage URL",
  },
  {
    path: ["author", "name"],
    match: "Anomaly",
    replacement: "Altimate AI",
    description: "author.name",
  },
  {
    path: ["publisher"],
    match: "anomalyco",
    replacement: "altimateai",
    description: "publisher",
  },
]

/** Get a nested value from an object by path. */
function getByPath(obj: any, pathParts: string[]): any {
  let current = obj
  for (const key of pathParts) {
    if (current == null || typeof current !== "object") return undefined
    current = current[key]
  }
  return current
}

/** Set a nested value in an object by path. */
function setByPath(obj: any, pathParts: string[], value: any): void {
  let current = obj
  for (let i = 0; i < pathParts.length - 1; i++) {
    const key = pathParts[i]
    if (current[key] == null || typeof current[key] !== "object") return
    current = current[key]
  }
  current[pathParts[pathParts.length - 1]] = value
}

/** Transform a package.json file with Altimate Code branding. */
export async function transformPackageJson(
  filePath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const root = repoRoot()
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath)
  const relPath = path.relative(root, absPath)

  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  const content = fs.readFileSync(absPath, "utf-8")
  let pkg: any

  try {
    pkg = JSON.parse(content)
  } catch {
    return noChanges(relPath)
  }

  const changes: Change[] = []

  // Main package special transforms
  if (relPath === MAIN_PACKAGE) {
    // Name
    if (pkg.name && pkg.name !== "@altimateai/altimate-code") {
      changes.push({
        description: "package name",
        before: pkg.name,
        after: "@altimateai/altimate-code",
      })
      pkg.name = "@altimateai/altimate-code"
    }

    // Bin entries
    const currentBin = pkg.bin || {}
    const desiredBin: Record<string, string> = {
      "altimate-code": "./bin/cli.mjs",
      altimate: "./bin/cli.mjs",
    }

    // Remove upstream opencode bin entry
    if ("opencode" in currentBin) {
      changes.push({
        description: 'remove upstream "opencode" bin entry',
        before: `"opencode": "${currentBin.opencode}"`,
        after: "(removed)",
      })
      delete currentBin.opencode
    }

    // Add our bin entries
    for (const [name, target] of Object.entries(desiredBin)) {
      if (currentBin[name] !== target) {
        changes.push({
          description: `bin entry "${name}"`,
          before: currentBin[name] ?? "(missing)",
          after: target,
        })
        currentBin[name] = target
      }
    }

    pkg.bin = desiredBin
  }

  // General transforms for all package.json files
  for (const transform of REPO_TRANSFORMS) {
    const current = getByPath(pkg, transform.path)
    if (current === undefined || typeof current !== "string") continue

    const updated =
      typeof transform.match === "string"
        ? current.replace(transform.match, transform.replacement)
        : current.replace(transform.match, transform.replacement)

    if (updated !== current) {
      changes.push({
        description: transform.description,
        before: current,
        after: updated,
      })
      setByPath(pkg, transform.path, updated)
    }
  }

  // Update author.email if it contains opencode
  const authorEmail = getByPath(pkg, ["author", "email"])
  if (typeof authorEmail === "string" && authorEmail.includes("opencode")) {
    const updated = authorEmail.replace(/opencode/g, "altimate-code")
    changes.push({
      description: "author.email",
      before: authorEmail,
      after: updated,
    })
    setByPath(pkg, ["author", "email"], updated)
  }

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8")
  }

  return { filePath: relPath, applied: !options?.dryRun, changes }
}

/** Recursively find all package.json files, skipping node_modules and .venv. */
function findPackageJsonFiles(dir: string): string[] {
  const skipDirs = new Set(["node_modules", ".git", ".venv", "dist"])
  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      results.push(...findPackageJsonFiles(fullPath))
    } else if (entry.name === "package.json") {
      results.push(fullPath)
    }
  }

  return results
}

/** Transform all package.json files in the repo. */
export async function transformAllPackageJson(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const root = repoRoot()
  const files = findPackageJsonFiles(root)
  const reports: FileReport[] = []

  for (const file of files) {
    const report = await transformPackageJson(file, options)
    reports.push(report)
  }

  return reports
}
