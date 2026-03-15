import { minimatch } from "minimatch"
import { git, conflictedFiles } from "../utils/git"
import { loadConfig } from "../utils/config"

/** Check if a file path matches any keepOurs pattern. */
export function shouldKeepOurs(filePath: string): boolean {
  const config = loadConfig()
  return config.keepOurs.some((pattern) => minimatch(filePath, pattern))
}

/**
 * For conflicted files matching keepOurs patterns, resolve by keeping our version.
 * Uses `git checkout HEAD -- <file>` to restore our version.
 * Returns the list of resolved file paths.
 */
export function resolveKeepOurs(): { resolved: string[] } {
  const conflicts = conflictedFiles()
  const resolved: string[] = []

  for (const file of conflicts) {
    if (shouldKeepOurs(file)) {
      git(`checkout --ours -- "${file}"`)
      git(`add "${file}"`)
      resolved.push(file)
    }
  }

  return { resolved }
}

/** Reset all keepOurs files to our version (git checkout HEAD -- <file>). */
export async function resetKeepOursFiles(): Promise<string[]> {
  const config = loadConfig()
  const output = git("diff --name-only HEAD")
  const modifiedFiles = output
    .split("\n")
    .filter((f) => f.length > 0)

  const restored: string[] = []

  for (const file of modifiedFiles) {
    if (shouldKeepOurs(file)) {
      git(`checkout HEAD -- "${file}"`)
      restored.push(file)
    }
  }

  return restored
}

/** Get list of keepOurs glob patterns. */
export function getKeepOursList(): string[] {
  const config = loadConfig()
  return [...config.keepOurs]
}
