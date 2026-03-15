#!/usr/bin/env bun
/**
 * Upstream Merge Analysis & Verification
 *
 * Two modes of operation:
 *
 * 1. Version analysis — preview what would change for a specific upstream version
 *    bun run script/upstream/analyze.ts --version v1.2.21
 *
 * 2. Branding audit — scan the codebase for upstream branding that leaked through
 *    bun run script/upstream/analyze.ts --branding
 *    bun run script/upstream/analyze.ts --branding --verbose
 *
 * Exit codes:
 *   0 — No issues found
 *   1 — Branding leaks detected (useful for CI)
 *   2 — Error during analysis
 */

import { parseArgs } from "util"
import { $ } from "bun"
import fs from "fs"
import path from "path"
import * as git from "./utils/git"
import * as logger from "./utils/logger"
import { loadConfig, repoRoot, type MergeConfig } from "./utils/config"

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    version: { type: "string", short: "v" },
    branding: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: false,
}) as any

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const MAGENTA = "\x1b[35m"

function bold(s: string): string { return `${BOLD}${s}${RESET}` }
function dim(s: string): string { return `${DIM}${s}${RESET}` }
function cyan(s: string): string { return `${CYAN}${s}${RESET}` }

function banner(text: string): void {
  const line = "═".repeat(60)
  console.log(`\n${CYAN}${line}${RESET}`)
  console.log(`${CYAN}  ${BOLD}${text}${RESET}`)
  console.log(`${CYAN}${line}${RESET}\n`)
}

// ---------------------------------------------------------------------------
// Branding leak detection
// ---------------------------------------------------------------------------

interface BrandingLeak {
  file: string
  line: number
  content: string
  pattern: string
}

interface BrandingReport {
  totalFiles: number
  scannedFiles: number
  leaks: BrandingLeak[]
  preservedLines: number
  timestamp: string
}

/**
 * Upstream branding patterns that should NOT appear in the codebase
 * (except in preserved contexts like npm package names).
 */
const LEAK_PATTERNS = [
  { regex: /opencode\.ai/g, label: "opencode.ai (domain)" },
  { regex: /opncd\.ai/g, label: "opncd.ai (short domain)" },
  { regex: /anomalyco\//g, label: "anomalyco/ (GitHub org)" },
  { regex: /\bOpenCode\b/g, label: "OpenCode (product name)" },
  { regex: /bot@opencode/g, label: "bot@opencode (email)" },
  { regex: /opencode@sst\.dev/g, label: "opencode@sst.dev (email)" },
  { regex: /ai\.opencode\./g, label: "ai.opencode.* (app ID)" },
  { regex: /x\.com\/altaborodin/g, label: "altaborodin (social handle)" },
  { regex: /ghcr\.io\/anomalyco/g, label: "ghcr.io/anomalyco (container registry)" },
]

/**
 * Check whether a line should be excluded from branding leak detection.
 */
function isPreservedLine(line: string, preservePatterns: string[]): boolean {
  return preservePatterns.some((pattern) => line.includes(pattern))
}

/**
 * Scan all tracked files for upstream branding patterns that should
 * have been transformed during the merge process.
 */
async function auditBranding(config: MergeConfig): Promise<BrandingReport> {
  const { minimatch } = await import("minimatch")
  const root = repoRoot()
  const trackedFiles = await git.getTrackedFiles()

  const report: BrandingReport = {
    totalFiles: trackedFiles.length,
    scannedFiles: 0,
    leaks: [],
    preservedLines: 0,
    timestamp: new Date().toISOString(),
  }

  for (const relFile of trackedFiles) {
    // Skip keepOurs files — they contain our own branding
    if (config.keepOurs.some((p) => minimatch(relFile, p))) continue

    // Skip non-text files
    const ext = path.extname(relFile).toLowerCase()
    if (!config.transformableExtensions.includes(ext)) continue

    const fullPath = path.join(root, relFile)
    if (!fs.existsSync(fullPath)) continue

    // Skip large files
    try {
      const stat = fs.statSync(fullPath)
      if (stat.size > 5 * 1024 * 1024) continue
    } catch {
      continue
    }

    let content: string
    try {
      content = fs.readFileSync(fullPath, "utf-8")
    } catch {
      continue
    }

    report.scannedFiles++

    const lines = content.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      // Skip preserved lines (npm package refs, internal identifiers, etc.)
      if (isPreservedLine(line, config.preservePatterns)) {
        report.preservedLines++
        continue
      }

      for (const { regex, label } of LEAK_PATTERNS) {
        regex.lastIndex = 0
        if (regex.test(line)) {
          report.leaks.push({
            file: relFile,
            line: i + 1,
            content: line.trim(),
            pattern: label,
          })
        }
      }
    }
  }

  return report
}

/**
 * Print a human-readable branding audit report.
 */
function printBrandingReport(report: BrandingReport, verbose: boolean): void {
  banner("Branding Audit Report")

  console.log(`  Files in repository:  ${report.totalFiles}`)
  console.log(`  Files scanned:        ${report.scannedFiles}`)
  console.log(`  Preserved lines:      ${report.preservedLines} ${dim("(skipped, contain internal refs)")}`)
  console.log(`  Leaks found:          ${report.leaks.length > 0 ? RED : GREEN}${report.leaks.length}${RESET}`)
  console.log()

  if (report.leaks.length === 0) {
    logger.success("No branding leaks detected — codebase is clean")
    return
  }

  // Group leaks by file
  const byFile = new Map<string, BrandingLeak[]>()
  for (const leak of report.leaks) {
    const existing = byFile.get(leak.file) || []
    existing.push(leak)
    byFile.set(leak.file, existing)
  }

  // Group leaks by pattern
  const byPattern = new Map<string, number>()
  for (const leak of report.leaks) {
    byPattern.set(leak.pattern, (byPattern.get(leak.pattern) || 0) + 1)
  }

  // Pattern summary
  console.log(`  ${bold("By pattern:")}`)
  for (const [pattern, count] of [...byPattern.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${YELLOW}${String(count).padStart(4)}${RESET}  ${pattern}`)
  }
  console.log()

  // File-by-file detail
  console.log(`  ${bold("By file:")} (${byFile.size} file(s))`)

  const maxFilesToShow = verbose ? byFile.size : 20
  let fileCount = 0

  for (const [file, leaks] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (fileCount >= maxFilesToShow) {
      console.log(`\n  ${DIM}... and ${byFile.size - maxFilesToShow} more file(s). Use --verbose to see all.${RESET}`)
      break
    }

    console.log(`\n  ${MAGENTA}${file}${RESET} (${leaks.length} leak(s))`)

    const maxLeaksToShow = verbose ? leaks.length : 5
    for (let i = 0; i < Math.min(leaks.length, maxLeaksToShow); i++) {
      const leak = leaks[i]
      const truncated = leak.content.length > 80
        ? leak.content.slice(0, 77) + "..."
        : leak.content
      console.log(`    ${DIM}L${String(leak.line).padStart(4)}${RESET}  ${YELLOW}${leak.pattern}${RESET}`)
      console.log(`          ${DIM}${truncated}${RESET}`)
    }

    if (leaks.length > maxLeaksToShow) {
      console.log(`    ${DIM}... and ${leaks.length - maxLeaksToShow} more${RESET}`)
    }

    fileCount++
  }
}

// ---------------------------------------------------------------------------
// Version analysis
// ---------------------------------------------------------------------------

interface VersionAnalysis {
  version: string
  totalChanges: number
  categories: {
    keepOurs: string[]
    skipFiles: string[]
    lockFiles: string[]
    transformable: string[]
    passThrough: string[]
  }
  markerFiles: string[]
  potentialConflicts: string[]
}

async function analyzeVersion(version: string, config: MergeConfig): Promise<VersionAnalysis> {
  const { minimatch } = await import("minimatch")
  const root = repoRoot()

  // Ensure upstream is fetched
  const hasUpstream = await git.hasRemote(config.upstreamRemote)
  if (!hasUpstream) {
    logger.error(`Remote '${config.upstreamRemote}' not found`)
    logger.info(`Add it: git remote add ${config.upstreamRemote} https://github.com/${config.upstreamRepo}.git`)
    process.exit(2)
  }

  await git.fetchRemote(config.upstreamRemote)

  // Get changed files
  const diffOutput = await $`git diff --name-only HEAD...${version}`.cwd(root).text()
  const files = diffOutput.trim().split("\n").filter(Boolean)

  const analysis: VersionAnalysis = {
    version,
    totalChanges: files.length,
    categories: {
      keepOurs: [],
      skipFiles: [],
      lockFiles: [],
      transformable: [],
      passThrough: [],
    },
    markerFiles: [],
    potentialConflicts: [],
  }

  for (const file of files) {
    if (config.keepOurs.some((p) => minimatch(file, p))) {
      analysis.categories.keepOurs.push(file)
    } else if (config.skipFiles.some((p) => minimatch(file, p))) {
      analysis.categories.skipFiles.push(file)
    } else if (file === "bun.lock" || file.endsWith("/bun.lock")) {
      analysis.categories.lockFiles.push(file)
    } else {
      const ext = path.extname(file).toLowerCase()
      if (config.transformableExtensions.includes(ext)) {
        analysis.categories.transformable.push(file)
      } else {
        analysis.categories.passThrough.push(file)
      }
    }
  }

  // Check for marker files and potential conflicts
  for (const file of analysis.categories.transformable) {
    try {
      const content = await $`git show HEAD:${file}`.cwd(root).text().catch(() => "")

      if (content.includes(config.changeMarker)) {
        analysis.markerFiles.push(file)
      }

      // Check if we've modified this file (potential conflict)
      const ourDiff = await $`git diff HEAD -- ${file}`.cwd(root).text().catch(() => "")
      if (ourDiff.trim().length > 0) {
        analysis.potentialConflicts.push(file)
      }
    } catch {
      // File may not exist on HEAD
    }
  }

  return analysis
}

function printVersionAnalysis(analysis: VersionAnalysis): void {
  banner(`Version Analysis: ${analysis.version}`)

  const { categories } = analysis

  console.log(`  ${bold("Total files changed upstream:")} ${analysis.totalChanges}`)
  console.log()

  const cats = [
    { label: "Keep ours (auto-resolve)", files: categories.keepOurs, color: GREEN },
    { label: "Skip files (accept upstream)", files: categories.skipFiles, color: CYAN },
    { label: "Lock files (regenerate)", files: categories.lockFiles, color: YELLOW },
    { label: "Need branding transform", files: categories.transformable, color: MAGENTA },
    { label: "Pass-through (no transform)", files: categories.passThrough, color: DIM },
  ]

  for (const { label, files, color } of cats) {
    console.log(`  ${color}${label}:${RESET} ${files.length}`)
  }

  // Files with altimate_change markers
  if (analysis.markerFiles.length > 0) {
    console.log()
    console.log(`  ${bold("Files with altimate_change markers")} ${dim("(need careful review):")}`)
    for (const f of analysis.markerFiles) {
      console.log(`    ${YELLOW}marked${RESET}  ${f}`)
    }
  }

  // Potential conflicts
  if (analysis.potentialConflicts.length > 0) {
    console.log()
    console.log(`  ${bold("Potential conflicts")} ${dim("(we modified + upstream modified):")}`)
    for (const f of analysis.potentialConflicts) {
      console.log(`    ${RED}conflict${RESET}  ${f}`)
    }
  }

  // Summary
  console.log()
  const line = "─".repeat(50)
  console.log(`  ${line}`)
  console.log(`  ${bold("Merge estimate:")}`)
  console.log(`    Auto-resolvable:  ${GREEN}${categories.keepOurs.length + categories.skipFiles.length + categories.lockFiles.length}${RESET}`)
  console.log(`    Need transform:   ${categories.transformable.length}`)
  console.log(`    Likely conflicts: ${analysis.potentialConflicts.length > 0 ? RED : GREEN}${analysis.potentialConflicts.length}${RESET}`)
  console.log(`    Marker files:     ${analysis.markerFiles.length > 0 ? YELLOW : GREEN}${analysis.markerFiles.length}${RESET}`)
  console.log()
}

// ---------------------------------------------------------------------------
// Marker analysis (from original analyze.ts)
// ---------------------------------------------------------------------------

interface MarkerBlock {
  file: string
  line: number
  startComment: string
  endLine: number | null
}

function findFilesRecursive(dir: string, extensions: string[]): string[] {
  const files: string[] = []
  if (!fs.existsSync(dir)) return files

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findFilesRecursive(fullPath, extensions))
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath)
    }
  }

  return files
}

function findMarkers(config: MergeConfig): MarkerBlock[] {
  const marker = config.changeMarker
  const root = repoRoot()
  const blocks: MarkerBlock[] = []

  const srcDir = path.join(root, "packages", "opencode", "src")
  const files = findFilesRecursive(srcDir, [".ts", ".tsx", ".json", ".txt"])

  for (const file of files) {
    const relPath = path.relative(root, file)
    // Skip our own code directory
    if (relPath.includes("src/altimate/")) continue

    const content = fs.readFileSync(file, "utf-8")
    const lines = content.split("\n")

    let openBlock: MarkerBlock | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (line.includes(`${marker} start`)) {
        openBlock = {
          file: relPath,
          line: i + 1,
          startComment: line.trim(),
          endLine: null,
        }
      } else if (line.includes(`${marker} end`) && openBlock) {
        openBlock.endLine = i + 1
        blocks.push(openBlock)
        openBlock = null
      }
    }

    // Unclosed marker block
    if (openBlock) {
      blocks.push(openBlock)
    }
  }

  return blocks
}

function printMarkerAnalysis(config: MergeConfig): void {
  console.log(`\n${bold("=== altimate_change Marker Analysis ===")}`)
  console.log()

  const markers = findMarkers(config)
  const complete = markers.filter((m) => m.endLine !== null)
  const incomplete = markers.filter((m) => m.endLine === null)

  console.log(`  Found ${bold(String(markers.length))} marker blocks in ${new Set(markers.map((m) => m.file)).size} files`)
  console.log(`  ${GREEN}Complete (start + end):${RESET} ${complete.length}`)

  if (incomplete.length > 0) {
    console.log(`  ${RED}Incomplete (missing end):${RESET} ${incomplete.length}`)
    for (const m of incomplete) {
      console.log(`    ${RED}unclosed${RESET}  ${m.file}:${m.line}`)
      console.log(`              ${DIM}${m.startComment}${RESET}`)
    }
  }

  // List all marked files
  const fileSet = new Set(markers.map((m) => m.file))
  console.log()
  console.log(`  ${bold("Files with markers:")}`)
  for (const f of [...fileSet].sort()) {
    const count = markers.filter((m) => m.file === f).length
    console.log(`    ${f} (${count} block${count > 1 ? "s" : ""})`)
  }

  // Summary
  console.log()
  console.log(`  ${bold("Integrity:")} ${incomplete.length === 0
    ? `${GREEN}All blocks properly closed${RESET}`
    : `${RED}${incomplete.length} unclosed block(s)${RESET}`
  }`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printUsage(): void {
  console.log(`
  ${bold("Upstream Merge Analyzer")} — Analyze changes and verify branding

  ${bold("USAGE")}
    bun run script/upstream/analyze.ts --version <tag>    Analyze upstream version
    bun run script/upstream/analyze.ts --branding         Audit for branding leaks

  ${bold("OPTIONS")}
    --version, -v <tag>   Upstream version to analyze
    --branding            Scan codebase for upstream branding leaks
    --verbose             Show all results (not just top 20)
    --json                Output results as JSON
    --help, -h            Show this help message

  ${bold("EXAMPLES")}
    ${dim("# Preview what would change in a merge")}
    bun run script/upstream/analyze.ts --version v1.2.21

    ${dim("# Check for branding leaks after a merge")}
    bun run script/upstream/analyze.ts --branding

    ${dim("# Full branding audit with all details")}
    bun run script/upstream/analyze.ts --branding --verbose

    ${dim("# Machine-readable output for CI")}
    bun run script/upstream/analyze.ts --branding --json
`)
}

async function main(): Promise<void> {
  if (args.help) {
    printUsage()
    process.exit(0)
  }

  const config = loadConfig()

  // Both --version and --branding can run together
  const hasVersion = Boolean(args.version)
  const hasBranding = Boolean(args.branding)

  if (!hasVersion && !hasBranding) {
    // Default: run marker analysis
    printMarkerAnalysis(config)

    console.log()
    logger.info("Use --version <tag> to analyze an upstream version")
    logger.info("Use --branding to audit for branding leaks")
    return
  }

  // ─── Version analysis ──────────────────────────────────────────────────────

  if (hasVersion) {
    const analysis = await analyzeVersion(args.version!, config)

    if (args.json) {
      console.log(JSON.stringify(analysis, null, 2))
    } else {
      printVersionAnalysis(analysis)
    }
  }

  // ─── Branding audit ────────────────────────────────────────────────────────

  if (hasBranding) {
    logger.info("Scanning codebase for upstream branding leaks...")
    const report = await auditBranding(config)

    if (args.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      printBrandingReport(report, Boolean(args.verbose))
    }

    // Also run marker analysis when doing branding audit
    if (!args.json) {
      printMarkerAnalysis(config)
    }

    // Exit with code 1 if leaks found (useful for CI)
    if (report.leaks.length > 0) {
      process.exit(1)
    }
  }
}

main().catch((e) => {
  logger.error(`Analysis failed: ${e.message || e}`)
  process.exit(2)
})
