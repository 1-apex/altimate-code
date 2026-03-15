import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Extension files to transform. */
const ZED_EXTENSION = "packages/extensions/zed/extension.toml"
const VSCODE_PACKAGE = "sdks/vscode/package.json"

/** Transform the Zed extension.toml file. */
async function transformZedExtension(
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const root = repoRoot()
  const absPath = path.join(root, ZED_EXTENSION)

  if (!fs.existsSync(absPath)) {
    return noChanges(ZED_EXTENSION)
  }

  let content = fs.readFileSync(absPath, "utf-8")
  const changes: Change[] = []

  const replacements: Array<{ match: RegExp; replacement: string; description: string }> = [
    {
      match: /^id\s*=\s*"opencode"/m,
      replacement: 'id = "altimate-code"',
      description: "extension id",
    },
    {
      match: /^name\s*=\s*"OpenCode"/m,
      replacement: 'name = "Altimate Code"',
      description: "extension name",
    },
    {
      match: /^authors\s*=\s*\["Anomaly"\]/m,
      replacement: 'authors = ["Altimate AI"]',
      description: "extension authors",
    },
    {
      match: /\[agent_servers\.opencode\]/g,
      replacement: "[agent_servers.altimate-code]",
      description: "agent_servers section name",
    },
    {
      match: /opencode-aarch64-apple-darwin/g,
      replacement: "altimate-code-aarch64-apple-darwin",
      description: "binary name (aarch64-apple-darwin)",
    },
    {
      match: /opencode-x86_64-apple-darwin/g,
      replacement: "altimate-code-x86_64-apple-darwin",
      description: "binary name (x86_64-apple-darwin)",
    },
    {
      match: /opencode-aarch64-unknown-linux/g,
      replacement: "altimate-code-aarch64-unknown-linux",
      description: "binary name (aarch64-unknown-linux)",
    },
    {
      match: /opencode-x86_64-unknown-linux/g,
      replacement: "altimate-code-x86_64-unknown-linux",
      description: "binary name (x86_64-unknown-linux)",
    },
    {
      match: /opencode-x86_64-pc-windows/g,
      replacement: "altimate-code-x86_64-pc-windows",
      description: "binary name (x86_64-pc-windows)",
    },
    {
      match: /cmd\s*=\s*"\.\/opencode"/g,
      replacement: 'cmd = "./altimate-code"',
      description: "agent command",
    },
    {
      match: /anomalyco\/opencode/g,
      replacement: "AltimateAI/altimate-code",
      description: "GitHub owner/repo in archive URLs",
    },
  ]

  for (const r of replacements) {
    const before = content
    content = content.replace(r.match, r.replacement)
    if (content !== before) {
      changes.push({ description: r.description })
    }
  }

  if (changes.length === 0) {
    return noChanges(ZED_EXTENSION)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, content, "utf-8")
  }

  return { filePath: ZED_EXTENSION, applied: !options?.dryRun, changes }
}

/** Transform the VSCode extension package.json. */
async function transformVscodeExtension(
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const root = repoRoot()
  const absPath = path.join(root, VSCODE_PACKAGE)

  if (!fs.existsSync(absPath)) {
    return noChanges(VSCODE_PACKAGE)
  }

  const content = fs.readFileSync(absPath, "utf-8")
  let pkg: any

  try {
    pkg = JSON.parse(content)
  } catch {
    return noChanges(VSCODE_PACKAGE)
  }

  const changes: Change[] = []

  // Name
  if (pkg.name && pkg.name.includes("opencode")) {
    const updated = pkg.name.replace(/opencode/g, "altimate-code")
    changes.push({ description: "extension name", before: pkg.name, after: updated })
    pkg.name = updated
  }

  // Display name
  if (pkg.displayName && pkg.displayName.includes("OpenCode")) {
    const updated = pkg.displayName.replace(/OpenCode/g, "Altimate Code")
    changes.push({ description: "displayName", before: pkg.displayName, after: updated })
    pkg.displayName = updated
  }

  // Description
  if (typeof pkg.description === "string" && pkg.description.includes("OpenCode")) {
    const updated = pkg.description.replace(/OpenCode/g, "Altimate Code")
    changes.push({ description: "description", before: pkg.description, after: updated })
    pkg.description = updated
  }

  // Publisher
  if (pkg.publisher === "anomalyco") {
    changes.push({ description: "publisher", before: pkg.publisher, after: "altimateai" })
    pkg.publisher = "altimateai"
  }

  // Repository URL
  if (typeof pkg.repository?.url === "string" && pkg.repository.url.includes("anomalyco")) {
    const updated = pkg.repository.url.replace(/anomalyco\/opencode/g, "AltimateAI/altimate-code")
    changes.push({ description: "repository.url", before: pkg.repository.url, after: updated })
    pkg.repository.url = updated
  }

  // Command titles in contributes.commands
  if (Array.isArray(pkg.contributes?.commands)) {
    for (const cmd of pkg.contributes.commands) {
      if (typeof cmd.title === "string" && cmd.title.includes("OpenCode")) {
        const updated = cmd.title.replace(/OpenCode/g, "Altimate Code")
        changes.push({ description: `command title "${cmd.command}"`, before: cmd.title, after: updated })
        cmd.title = updated
      }
    }
  }

  if (changes.length === 0) {
    return noChanges(VSCODE_PACKAGE)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8")
  }

  return { filePath: VSCODE_PACKAGE, applied: !options?.dryRun, changes }
}

/** Transform all editor extension files. */
export async function transformExtensions(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const reports: FileReport[] = []

  reports.push(await transformZedExtension(options))
  reports.push(await transformVscodeExtension(options))

  return reports
}
