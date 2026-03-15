import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Nix files to transform. */
const NIX_FILES = ["nix/opencode.nix", "nix/desktop.nix"]

/**
 * Patterns that MUST be preserved (not transformed).
 * These are internal Nix derivation references, env vars, or path segments.
 */
const PRESERVE_PATTERNS = [
  /pname\s*=\s*"opencode"/,         // Internal derivation name
  /OPENCODE_/,                       // Environment variables
  /packages\/opencode/,              // Source path references
  /inherit\s+\(opencode\)/,          // Nix inherit expressions
  /opencode\s*\)/,                   // Nix function parameter
]

/** Check if a line contains a pattern that should be preserved. */
function shouldPreserveLine(line: string): boolean {
  return PRESERVE_PATTERNS.some((p) => p.test(line))
}

/** Transform a single Nix file. */
async function transformNixFile(
  relPath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const root = repoRoot()
  const absPath = path.join(root, relPath)

  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  const content = fs.readFileSync(absPath, "utf-8")
  const lines = content.split("\n")
  const changes: Change[] = []
  const updatedLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]

    // Skip lines with patterns we must preserve
    if (shouldPreserveLine(line)) {
      updatedLines.push(line)
      continue
    }

    const original = line

    // Install path: $out/bin/opencode -> $out/bin/altimate-code
    line = line.replace(
      /\$out\/bin\/opencode(?!-desktop)/g,
      "$out/bin/altimate-code",
    )

    // Desktop binary: opencode-desktop -> altimate-code-desktop
    line = line.replace(/opencode-desktop/g, "altimate-code-desktop")

    // Share path: $out/share/opencode/ -> $out/share/altimate-code/
    line = line.replace(/\$out\/share\/opencode\//g, "$out/share/altimate-code/")

    // Shell completion: --cmd opencode -> --cmd altimate-code
    line = line.replace(/--cmd\s+opencode/g, "--cmd altimate-code")

    // mainProgram: mainProgram = "opencode" -> mainProgram = "altimate-code"
    line = line.replace(
      /mainProgram\s*=\s*"opencode"/g,
      'mainProgram = "altimate-code"',
    )

    // meta.description: ensure branded
    line = line.replace(
      /description\s*=\s*"[^"]*[Oo]pen[Cc]ode[^"]*"/g,
      (match) => match.replace(/OpenCode/g, "Altimate Code").replace(/opencode/g, "altimate-code"),
    )

    // meta.homepage: ensure altimate.ai
    line = line.replace(/opencode\.ai/g, "altimate.ai")

    if (line !== original) {
      changes.push({
        description: `line ${i + 1}`,
        before: original.trim(),
        after: line.trim(),
        line: i + 1,
      })
    }

    updatedLines.push(line)
  }

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, updatedLines.join("\n"), "utf-8")
  }

  return { filePath: relPath, applied: !options?.dryRun, changes }
}

/** Transform all Nix package files. */
export async function transformNix(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const reports: FileReport[] = []

  for (const file of NIX_FILES) {
    reports.push(await transformNixFile(file, options))
  }

  return reports
}
