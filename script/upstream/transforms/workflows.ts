import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Directory containing GitHub workflow files. */
const WORKFLOWS_DIR = ".github/workflows"

/**
 * Patterns that indicate upstream branding in workflow files.
 * This is a diagnostic tool — workflows are in keepOurs, so they
 * are not auto-transformed. This audits for any upstream branding
 * that might have been introduced when selectively accepting
 * upstream workflow changes.
 */
const AUDIT_PATTERNS: Array<{
  match: RegExp
  description: string
}> = [
  { match: /anomalyco\/opencode/g, description: "GitHub owner/repo reference" },
  { match: /opencode\.ai/g, description: "upstream website URL" },
  { match: /name:\s*OpenCode\b/g, description: "workflow name referencing OpenCode" },
  { match: /npm install.*\bopencode\b/g, description: "npm install referencing opencode" },
  { match: /opencode serve/g, description: "CLI command in workflow" },
]

/** Recursively find YAML workflow files. */
function findWorkflowFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  const results: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findWorkflowFiles(fullPath))
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      results.push(fullPath)
    }
  }

  return results
}

/**
 * Audit workflow files for any upstream branding that should be updated.
 *
 * This is a diagnostic tool, not an auto-transformer. Since workflows
 * are in keepOurs, they are fully controlled by us. This function
 * detects any upstream branding that may have been accidentally
 * introduced.
 */
export async function auditWorkflows(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const root = repoRoot()
  const workflowDir = path.join(root, WORKFLOWS_DIR)
  const files = findWorkflowFiles(workflowDir)
  const reports: FileReport[] = []

  for (const absPath of files) {
    const relPath = path.relative(root, absPath)
    const content = fs.readFileSync(absPath, "utf-8")
    const changes: Change[] = []

    for (const pattern of AUDIT_PATTERNS) {
      // Reset regex state
      pattern.match.lastIndex = 0
      const matches = content.match(pattern.match)
      if (matches) {
        for (const match of matches) {
          changes.push({
            description: `${pattern.description}: "${match}"`,
          })
        }
      }
    }

    if (changes.length > 0) {
      // Audit never applies changes — it only reports findings
      reports.push({ filePath: relPath, applied: false, changes })
    } else {
      reports.push(noChanges(relPath))
    }
  }

  return reports
}
