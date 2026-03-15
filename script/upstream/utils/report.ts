/**
 * Reporting types and utilities for upstream merge transforms.
 *
 * Each transform produces FileReport objects describing what was changed.
 */

/** A single change made to a file. */
export interface Change {
  /** Human-readable description of what was changed. */
  description?: string
  /** The original value (for context in reports). */
  before?: string
  /** The new value after transformation. */
  after?: string
  /** Line number where the change occurs, if applicable. */
  line?: number
  /** The branding rule that triggered this change. */
  rule?: string
  /** The file path (used in some report contexts). */
  file?: string
}

/** Report of changes made (or detected) in a single file. */
export interface FileReport {
  /** Relative path from repo root. */
  filePath?: string
  /** Relative path from repo root (alias). */
  file?: string
  /** The transform that produced this report. */
  transform?: string
  /** Whether any changes were applied (false in dry-run mode). */
  applied?: boolean
  /** List of individual changes. */
  changes: Change[]
}

/** Print a summary of file reports to the console. */
export function printReports(reports: FileReport[]): void {
  const changed = reports.filter((r) => r.changes.length > 0)
  const unchanged = reports.filter((r) => r.changes.length === 0)

  if (changed.length === 0) {
    console.log("  No changes detected.")
    return
  }

  for (const report of changed) {
    const status = report.applied ? "applied" : "would apply"
    console.log(`  ${report.filePath} (${status}, ${report.changes.length} change${report.changes.length === 1 ? "" : "s"})`)
    for (const change of report.changes) {
      console.log(`    - ${change.description}`)
      if (change.before !== undefined && change.after !== undefined) {
        console.log(`      "${change.before}" -> "${change.after}"`)
      }
    }
  }

  if (unchanged.length > 0) {
    console.log(`  ${unchanged.length} file${unchanged.length === 1 ? "" : "s"} unchanged.`)
  }
}

/** Create an empty report for a file with no changes. */
export function noChanges(filePath: string): FileReport {
  return { filePath, applied: false, changes: [] }
}

// ---------------------------------------------------------------------------
// MergeReport — aggregate report for an entire merge operation
// ---------------------------------------------------------------------------

/** Aggregate report for a full upstream merge. */
export interface MergeReport {
  version: string
  startedAt: string
  files: FileReport[]
  totalChanges: number
  totalFiles: number
  conflicts: string[]
}

/** Create a new empty MergeReport. */
export function createReport(version: string): MergeReport {
  return {
    version,
    startedAt: new Date().toISOString(),
    files: [],
    totalChanges: 0,
    totalFiles: 0,
    conflicts: [],
  }
}

/** Add a FileReport to a MergeReport. */
export function addFileReport(report: MergeReport, fileReport: FileReport): void {
  report.files.push(fileReport)
  if (fileReport.changes.length > 0) {
    report.totalFiles++
    report.totalChanges += fileReport.changes.length
  }
}

/** Print a summary of the merge report. */
export function printSummary(report: MergeReport): void {
  console.log(`\n  Merge Report: ${report.version}`)
  console.log(`  Started: ${report.startedAt}`)
  console.log(`  Files modified: ${report.totalFiles}`)
  console.log(`  Total changes: ${report.totalChanges}`)

  if (report.conflicts.length > 0) {
    console.log(`  Unresolved conflicts: ${report.conflicts.length}`)
    for (const f of report.conflicts) {
      console.log(`    - ${f}`)
    }
  }

  printReports(report.files)
}

/** Write the merge report to a JSON file. */
export function writeReport(report: MergeReport, outputPath: string): void {
  const fs = require("fs")
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + "\n", "utf-8")
  console.log(`  Report written to: ${outputPath}`)
}
