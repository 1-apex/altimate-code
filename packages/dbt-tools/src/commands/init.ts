import { resolve, join } from "path"
import { existsSync } from "fs"
import { write, findProjectRoot, discoverPython, type Config } from "../config"
import { all } from "../check"

export async function init(args: string[]) {
  const idx = args.indexOf("--project-root")
  const root = idx >= 0 ? args[idx + 1] : undefined
  const pidx = args.indexOf("--python-path")
  const py = pidx >= 0 ? args[pidx + 1] : undefined

  const project = root ? resolve(root) : findProjectRoot(process.cwd())
  if (!project) return { error: "No dbt_project.yml found. Use --project-root to specify." }
  if (!existsSync(join(project, "dbt_project.yml"))) return { error: `No dbt_project.yml in ${project}` }

  const cfg: Config = {
    projectRoot: project,
    pythonPath: py ?? discoverPython(project),
    dbtIntegration: "corecommand",
    queryLimit: 500,
  }

  await write(cfg)

  const health = await all(cfg)
  if (!health.passed) {
    const warnings = Object.entries(health.checks)
      .filter(([, v]) => !v.ok)
      .map(([k, v]) => ({ check: k, ...(v as { ok: false; error: string; fix: string }) }))
    return { ok: true, config: cfg, warnings }
  }

  return { ok: true, config: cfg }
}
