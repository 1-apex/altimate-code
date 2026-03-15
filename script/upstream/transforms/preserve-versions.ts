import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"

/** Files whose versions we preserve during upstream merges. */
const VERSION_FILES = [
  "packages/opencode/package.json",
  "packages/desktop/package.json",
  "packages/desktop-electron/package.json",
  "sdks/vscode/package.json",
  "packages/extensions/zed/extension.toml",
] as const

/** Read the version from a file. Supports package.json and extension.toml. */
function readVersion(absPath: string): string | null {
  if (!fs.existsSync(absPath)) return null

  const content = fs.readFileSync(absPath, "utf-8")

  if (absPath.endsWith(".toml")) {
    // Parse version from TOML: version = "x.y.z"
    const match = content.match(/^version\s*=\s*"([^"]+)"/m)
    return match ? match[1] : null
  }

  // JSON package.json
  try {
    const pkg = JSON.parse(content)
    return pkg.version ?? null
  } catch {
    return null
  }
}

/** Write a version back into a file. */
function writeVersion(absPath: string, version: string): void {
  const content = fs.readFileSync(absPath, "utf-8")

  if (absPath.endsWith(".toml")) {
    const updated = content.replace(
      /^(version\s*=\s*)"[^"]+"/m,
      `$1"${version}"`,
    )
    fs.writeFileSync(absPath, updated, "utf-8")
    return
  }

  // JSON package.json — parse, update, write with 2-space indent
  const pkg = JSON.parse(content)
  pkg.version = version
  fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8")
}

/** Snapshot current versions before merge. */
export async function snapshotVersions(): Promise<Record<string, string>> {
  const root = repoRoot()
  const snapshot: Record<string, string> = {}

  for (const relPath of VERSION_FILES) {
    const absPath = path.join(root, relPath)
    const version = readVersion(absPath)
    if (version) {
      snapshot[relPath] = version
    }
  }

  return snapshot
}

/** Restore our versions after merge. Returns list of files that were restored. */
export async function restoreVersions(
  snapshot: Record<string, string>,
): Promise<string[]> {
  const root = repoRoot()
  const restored: string[] = []

  for (const [relPath, ourVersion] of Object.entries(snapshot)) {
    const absPath = path.join(root, relPath)
    const currentVersion = readVersion(absPath)

    if (currentVersion !== null && currentVersion !== ourVersion) {
      writeVersion(absPath, ourVersion)
      restored.push(relPath)
    }
  }

  return restored
}
