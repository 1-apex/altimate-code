/**
 * Core branding transform for upstream merge automation.
 *
 * Applies string-level replacements to convert OpenCode/anomalyco references
 * to Altimate Code/AltimateAI. This is the heart of the branding system —
 * every merge from upstream runs through these transforms to rebrand the
 * codebase in a single pass.
 *
 * Rule application order matters:
 *   1. URL rules (always apply — unambiguous domain swaps)
 *   2. GitHub repo rules (always apply)
 *   3. Container registry rules (always apply)
 *   4. Email rules (always apply)
 *   5. App identifier rules (always apply)
 *   6. Social rules (always apply)
 *   7. npm install rules (always apply — they match specific command patterns)
 *   8. CLI binary rules (always apply)
 *   9. Product name rules — ONLY if the line is NOT preserved
 *
 * Preservation patterns protect internal code references (imports, env vars,
 * directory names) from being mangled by product name transforms.
 */

import { Glob } from "bun"
import path from "path"
import { minimatch } from "minimatch"
import {
  defaultConfig,
  loadConfig,
  repoRoot,
  type MergeConfig,
  type StringReplacement,
} from "../utils/config"
import type { Change, FileReport } from "../utils/report"
import { noChanges } from "../utils/report"

// ---------------------------------------------------------------------------
// Directories and paths to skip when walking the repo tree.
// These never contain transformable source code.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".venv",
  "dist",
  ".next",
  ".turbo",
  ".cache",
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if a line should be preserved (not have product name transforms applied).
 * Returns true if the line contains any preservation pattern.
 *
 * Preservation patterns are substrings like `@opencode-ai/`, `OPENCODE_`, etc.
 * that indicate internal code references. URL and GitHub transforms are
 * unambiguous and still apply to preserved lines — only the generic product
 * name swap ("OpenCode" -> "Altimate Code") is skipped.
 */
export function shouldPreserveLine(
  line: string,
  preservePatterns: string[],
): boolean {
  return preservePatterns.some((pattern) => line.includes(pattern))
}

/**
 * Apply all branding replacements to a single line of text.
 *
 * Respects preservation patterns for product name transforms.
 * URL/GitHub/registry/email/app-id/social/npm-install/cli-binary transforms
 * always apply because they are unambiguous string swaps. Product name
 * transforms ("OpenCode" -> "Altimate Code") only apply when the line is
 * NOT preserved.
 *
 * @param line     - The original line of text.
 * @param config   - The merge configuration containing all rule sets.
 * @returns An object with the (possibly transformed) line and a list of changes.
 */
export function transformLine(
  line: string,
  config: MergeConfig,
): { line: string; changes: Change[] } {
  const changes: Change[] = []
  let current = line

  // Helper: apply a set of rules and track changes.
  function applyRules(rules: StringReplacement[]) {
    for (const rule of rules) {
      // Reset lastIndex for sticky/global regexes
      rule.pattern.lastIndex = 0
      if (rule.pattern.test(current)) {
        rule.pattern.lastIndex = 0
        const before = current
        current = current.replace(rule.pattern, rule.replacement)
        if (current !== before) {
          changes.push({
            description: rule.description,
            rule: rule.description,
            // Line number is filled in by the caller (applyBranding)
            line: 0,
            before,
            after: current,
          })
        }
      }
    }
  }

  // 1-8: These rule categories always apply — they are unambiguous.
  // The brandingRules array contains ALL rules in specificity order,
  // but we need to separate product name rules for preservation logic.
  // Use the dedicated rule arrays from config to apply non-product-name
  // rules first, then conditionally apply product name rules.
  //
  // The brandingRules array is the union of all categories. Rather than
  // rely on that flat list, we apply each category's rules directly from
  // the config so we can gate product name rules on preservation.

  // URL, GitHub, registry, email, app-id, social, npm-install, and
  // cli-binary rules are all embedded in brandingRules but NOT in
  // productNameRules. We apply everything in brandingRules EXCEPT
  // productNameRules first (those are the "always apply" set).
  const alwaysApplyRules = config.brandingRules.filter(
    (rule) => !config.productNameRules.includes(rule),
  )
  applyRules(alwaysApplyRules)

  // 9: Product name rules — only apply if the line is NOT preserved.
  const preserved = shouldPreserveLine(current, config.preservePatterns)
  if (!preserved) {
    applyRules(config.productNameRules)
  }

  return { line: current, changes }
}

/**
 * Apply all branding transforms to file content.
 *
 * Splits the content line-by-line, transforms each line, and reassembles.
 * Returns the modified content and a flat list of all changes with correct
 * line numbers.
 *
 * @param content  - The full file content as a string.
 * @param filePath - Relative path (used only for diagnostics, not I/O).
 * @param config   - Optional override config; defaults to defaultConfig.
 * @returns Modified content and list of changes.
 */
export function applyBranding(
  content: string,
  filePath: string,
  config: MergeConfig = defaultConfig,
): { content: string; changes: Change[] } {
  const lines = content.split("\n")
  const allChanges: Change[] = []
  const transformed: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const result = transformLine(lines[i], config)

    // Stamp the correct 1-based line number on each change
    for (const change of result.changes) {
      change.line = i + 1
      allChanges.push(change)
    }

    transformed.push(result.line)
  }

  return {
    content: transformed.join("\n"),
    changes: allChanges,
  }
}

/**
 * Apply branding transforms to a single file on disk.
 *
 * Reads the file, applies all branding rules via `applyBranding`, and
 * optionally writes the result back. Returns a FileReport describing
 * what was changed.
 *
 * @param filePath - Absolute or repo-relative path to the file.
 * @param options  - `dryRun: true` skips the write step.
 * @returns A FileReport with the list of changes.
 */
export async function transformFile(
  filePath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const config = loadConfig()
  const root = repoRoot()
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(root, filePath)
  const relPath = path.relative(root, absPath)

  // Only transform files with recognized extensions
  const ext = path.extname(absPath).toLowerCase()
  if (!config.transformableExtensions.includes(ext)) {
    return noChanges(relPath)
  }

  // Read file content using Bun's file API
  const file = Bun.file(absPath)
  if (!(await file.exists())) {
    return noChanges(relPath)
  }

  const content = await file.text()
  const { content: branded, changes } = applyBranding(content, relPath, config)

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  // Write the transformed content back unless this is a dry run
  if (!options?.dryRun) {
    await Bun.write(absPath, branded)
  }

  return {
    filePath: relPath,
    applied: !options?.dryRun,
    changes: changes.map((c) => ({
      description: `${c.rule ?? c.description} (L${c.line})`,
      before: c.before?.trim(),
      after: c.after?.trim(),
      line: c.line,
      rule: c.rule,
    })),
  }
}

/**
 * Apply branding transforms to all transformable files in the repo.
 *
 * Walks the repository tree using Bun's Glob, respects keepOurs patterns
 * (those files are ours and shouldn't be re-branded), and only processes
 * files whose extensions are in `transformableExtensions`.
 *
 * @param options - `dryRun: true` skips writes; `verbose: true` logs each file.
 * @returns An array of FileReports for files that had changes.
 */
export async function transformAll(
  options?: { dryRun?: boolean; verbose?: boolean },
): Promise<FileReport[]> {
  const config = loadConfig()
  const root = repoRoot()
  const reports: FileReport[] = []

  // Build a glob pattern that matches all transformable extensions.
  // Bun's Glob doesn't support {a,b,c} alternation in all cases,
  // so we run one glob per extension.
  for (const ext of config.transformableExtensions) {
    // ext includes the leading dot, e.g. ".ts"
    const pattern = `**/*${ext}`
    const glob = new Glob(pattern)

    for await (const relPath of glob.scan({
      cwd: root,
      dot: false,
      onlyFiles: true,
    })) {
      // Skip files inside ignored directories
      const parts = relPath.split(path.sep)
      if (parts.some((part) => SKIP_DIRS.has(part))) {
        continue
      }

      // Skip files matching keepOurs — those are our custom files and
      // should not have upstream branding transforms applied to them.
      const isKept = config.keepOurs.some((pattern) =>
        minimatch(relPath, pattern),
      )
      if (isKept) {
        continue
      }

      if (options?.verbose) {
        console.log(`  scanning: ${relPath}`)
      }

      const report = await transformFile(path.join(root, relPath), options)
      if (report.changes.length > 0) {
        reports.push(report)
      }
    }
  }

  return reports
}
