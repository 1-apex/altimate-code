import fs from "fs"
import path from "path"
import { repoRoot } from "../utils/config"
import type { FileReport, Change } from "../utils/report"
import { noChanges } from "../utils/report"

/** Tauri JSON config files to transform. */
const TAURI_CONFIGS = [
  "packages/desktop/src-tauri/tauri.conf.json",
  "packages/desktop/src-tauri/tauri.prod.conf.json",
  "packages/desktop/src-tauri/tauri.beta.conf.json",
]

/** Electron builder config (TypeScript, handled via string replacement). */
const ELECTRON_CONFIG = "packages/desktop-electron/electron-builder.config.ts"

/** JSON field transforms for Tauri configs. */
interface JsonTransform {
  /** Dot-separated path to the field. */
  jsonPath: string
  /** Value pattern to match. */
  match: string | RegExp
  /** Replacement value. */
  replacement: string
  /** Description for reporting. */
  description: string
}

const TAURI_JSON_TRANSFORMS: JsonTransform[] = [
  {
    jsonPath: "productName",
    match: /^OpenCode$/,
    replacement: "Altimate Code",
    description: "productName",
  },
  {
    jsonPath: "productName",
    match: /^OpenCode Dev$/,
    replacement: "Altimate Code Dev",
    description: "productName (Dev)",
  },
  {
    jsonPath: "productName",
    match: /^OpenCode Beta$/,
    replacement: "Altimate Code Beta",
    description: "productName (Beta)",
  },
  {
    jsonPath: "mainBinaryName",
    match: /^OpenCode$/,
    replacement: "Altimate Code",
    description: "mainBinaryName",
  },
  {
    jsonPath: "mainBinaryName",
    match: /^OpenCode Dev$/,
    replacement: "Altimate Code Dev",
    description: "mainBinaryName (Dev)",
  },
  {
    jsonPath: "mainBinaryName",
    match: /^OpenCode Beta$/,
    replacement: "Altimate Code Beta",
    description: "mainBinaryName (Beta)",
  },
]

/** Get a value from a nested JSON object using dot-separated path. */
function getByDotPath(obj: any, dotPath: string): any {
  const parts = dotPath.split(".")
  let current = obj
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined
    current = current[part]
  }
  return current
}

/** Set a value in a nested JSON object using dot-separated path. */
function setByDotPath(obj: any, dotPath: string, value: any): void {
  const parts = dotPath.split(".")
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== "object") return
    current = current[parts[i]]
  }
  current[parts[parts.length - 1]] = value
}

/** Transform a single Tauri JSON config file. */
export async function transformTauriConfig(
  filePath: string,
  options?: { dryRun?: boolean },
): Promise<FileReport> {
  const root = repoRoot()
  const absPath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath)
  const relPath = path.relative(root, absPath)

  if (!fs.existsSync(absPath)) {
    return noChanges(relPath)
  }

  const content = fs.readFileSync(absPath, "utf-8")
  const changes: Change[] = []

  if (absPath.endsWith(".ts")) {
    // Electron builder config — use string replacement
    return transformElectronConfig(absPath, relPath, content, options)
  }

  // Tauri JSON config
  let config: any
  try {
    config = JSON.parse(content)
  } catch {
    return noChanges(relPath)
  }

  // Apply named field transforms
  for (const transform of TAURI_JSON_TRANSFORMS) {
    const current = getByDotPath(config, transform.jsonPath)
    if (current === undefined || typeof current !== "string") continue

    const matches =
      typeof transform.match === "string"
        ? current === transform.match
        : transform.match.test(current)

    if (matches) {
      const updated =
        typeof transform.match === "string"
          ? transform.replacement
          : current.replace(transform.match, transform.replacement)
      changes.push({
        description: transform.description,
        before: current,
        after: updated,
      })
      setByDotPath(config, transform.jsonPath, updated)
    }
  }

  // Apply identifier transforms recursively
  transformIdentifiersInConfig(config, changes)

  // Transform updater endpoints (GitHub URLs)
  transformUpdaterEndpoints(config, changes)

  // Transform protocols
  transformProtocols(config, changes)

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  }

  return { filePath: relPath, applied: !options?.dryRun, changes }
}

/** Transform identifier strings throughout the config. */
function transformIdentifiersInConfig(config: any, changes: Change[]): void {
  // Walk the entire config looking for identifier patterns
  walkAndReplace(config, /ai\.opencode\./g, "ai.altimate.code.", "identifier", changes)
}

/** Transform updater endpoint URLs. */
function transformUpdaterEndpoints(config: any, changes: Change[]): void {
  const endpoints = getByDotPath(config, "plugins.updater.endpoints")
  if (!Array.isArray(endpoints)) return

  for (let i = 0; i < endpoints.length; i++) {
    if (typeof endpoints[i] !== "string") continue
    const updated = endpoints[i]
      .replace(/anomalyco\/opencode/g, "AltimateAI/altimate-code")
      .replace(/opencode/g, "altimate-code")
    if (updated !== endpoints[i]) {
      changes.push({
        description: `updater endpoint [${i}]`,
        before: endpoints[i],
        after: updated,
      })
      endpoints[i] = updated
    }
  }
}

/** Transform protocol definitions. */
function transformProtocols(config: any, changes: Change[]): void {
  const protocols = config.app?.security?.protocols ?? config.protocols
  if (!Array.isArray(protocols)) return

  for (const protocol of protocols) {
    if (protocol.name === "OpenCode") {
      changes.push({
        description: "protocol name",
        before: protocol.name,
        after: "Altimate Code",
      })
      protocol.name = "Altimate Code"
    }
  }
}

/** Walk an object tree and replace string values matching a pattern. */
function walkAndReplace(
  obj: any,
  pattern: RegExp,
  replacement: string,
  label: string,
  changes: Change[],
  currentPath: string = "",
): void {
  if (obj == null || typeof obj !== "object") return

  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj)

  for (const [key, value] of entries) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key

    if (typeof value === "string") {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0
      if (pattern.test(value)) {
        pattern.lastIndex = 0
        const updated = value.replace(pattern, replacement)
        if (Array.isArray(obj)) {
          obj[Number(key)] = updated
        } else {
          ;(obj as any)[key] = updated
        }
        changes.push({
          description: `${label} at ${fullPath}`,
          before: value,
          after: updated,
        })
      }
    } else if (typeof value === "object" && value !== null) {
      walkAndReplace(value, pattern, replacement, label, changes, fullPath)
    }
  }
}

/** Transform electron-builder.config.ts via string replacement. */
function transformElectronConfig(
  absPath: string,
  relPath: string,
  content: string,
  options?: { dryRun?: boolean },
): FileReport {
  const changes: Change[] = []
  let updated = content

  const replacements: Array<{ match: RegExp; replacement: string; description: string }> = [
    { match: /appId:\s*"ai\.opencode\./g, replacement: 'appId: "ai.altimate.code.', description: "appId identifier" },
    { match: /productName:\s*"OpenCode"/g, replacement: 'productName: "Altimate Code"', description: "productName" },
    { match: /opencode-electron/g, replacement: "altimate-code-electron", description: "artifact name" },
    { match: /packageName:\s*"opencode"/g, replacement: 'packageName: "altimate-code"', description: "rpm packageName" },
    { match: /packageName:\s*"opencode-dev"/g, replacement: 'packageName: "altimate-code-dev"', description: "rpm packageName (dev)" },
    { match: /packageName:\s*"opencode-beta"/g, replacement: 'packageName: "altimate-code-beta"', description: "rpm packageName (beta)" },
    { match: /owner:\s*"anomalyco"/g, replacement: 'owner: "AltimateAI"', description: "publish.owner" },
    { match: /repo:\s*"opencode"/g, replacement: 'repo: "altimate-code"', description: "publish.repo" },
  ]

  for (const r of replacements) {
    const before = updated
    updated = updated.replace(r.match, r.replacement)
    if (updated !== before) {
      changes.push({ description: r.description })
    }
  }

  if (changes.length === 0) {
    return noChanges(relPath)
  }

  if (!options?.dryRun) {
    fs.writeFileSync(absPath, updated, "utf-8")
  }

  return { filePath: relPath, applied: !options?.dryRun, changes }
}

/** Transform all Tauri and electron-builder config files. */
export async function transformAllTauri(
  options?: { dryRun?: boolean },
): Promise<FileReport[]> {
  const reports: FileReport[] = []

  for (const file of TAURI_CONFIGS) {
    reports.push(await transformTauriConfig(file, options))
  }

  reports.push(await transformTauriConfig(ELECTRON_CONFIG, options))

  return reports
}
