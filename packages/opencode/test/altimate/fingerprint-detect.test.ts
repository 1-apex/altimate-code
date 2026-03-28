import { describe, test, expect, beforeEach } from "bun:test"
import { Fingerprint } from "../../src/altimate/fingerprint"
import { tmpdir } from "../fixture/fixture"
import * as fs from "fs/promises"
import path from "path"

beforeEach(() => {
  Fingerprint.reset()
})

describe("Fingerprint.detect: file-based project detection", () => {
  test("detects dbt project from dbt_project.yml", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: my_project\nversion: 1.0.0\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("dbt")
    expect(result.tags).toContain("data-engineering")
  })

  test("detects adapter type from profiles.yml", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(
      path.join(tmp.path, "profiles.yml"),
      "my_profile:\n  target: dev\n  outputs:\n    dev:\n      type: snowflake\n",
    )
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("snowflake")
  })

  test("detects sql from .sqlfluff file", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, ".sqlfluff"), "[sqlfluff]\ndialect = bigquery\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("sql")
  })

  test("detects sql from .sql files when no .sqlfluff", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "query.sql"), "SELECT 1")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("sql")
  })

  test("detects airflow from airflow.cfg", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "airflow.cfg"), "[core]\nexecutor = LocalExecutor\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("airflow")
  })

  test("detects airflow from dags directory", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "dags"))
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("airflow")
  })

  test("detects databricks from databricks.yml", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "databricks.yml"), "bundle:\n  name: my_bundle\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("databricks")
  })

  test("returns empty tags for vanilla project", async () => {
    await using tmp = await tmpdir()
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toEqual([])
  })

  test("caches result for same cwd", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: test\n")
    const r1 = await Fingerprint.detect(tmp.path)
    // Remove the file — cached result should still have dbt
    await fs.rm(path.join(tmp.path, "dbt_project.yml"))
    const r2 = await Fingerprint.detect(tmp.path)
    expect(r1).toBe(r2) // Same reference (cached)
  })

  test("deduplicates tags from cwd and root scanning same markers", async () => {
    // When cwd !== root, both directories are scanned. If both contain
    // dbt_project.yml, the "dbt" and "data-engineering" tags should appear
    // only once each (the source deduplicates via Set).
    await using tmp = await tmpdir()
    const subdir = path.join(tmp.path, "models")
    await fs.mkdir(subdir)
    // Place dbt_project.yml in BOTH root and subdir
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: root\n")
    await fs.writeFile(path.join(subdir, "dbt_project.yml"), "name: sub\n")
    const result = await Fingerprint.detect(subdir, tmp.path)
    const dbtCount = result.tags.filter((t) => t === "dbt").length
    expect(dbtCount).toBe(1)
    const deCount = result.tags.filter((t) => t === "data-engineering").length
    expect(deCount).toBe(1)
  })

  test("scans both cwd and root when different", async () => {
    await using tmp = await tmpdir()
    const subdir = path.join(tmp.path, "models")
    await fs.mkdir(subdir)
    // dbt_project.yml only in root
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: test\n")
    // .sql file only in subdir
    await fs.writeFile(path.join(subdir, "model.sql"), "SELECT 1")
    const result = await Fingerprint.detect(subdir, tmp.path)
    expect(result.tags).toContain("dbt")
    expect(result.tags).toContain("sql")
  })

  test("detects dbt-packages from dbt_packages.yml", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "dbt_packages.yml"), "packages:\n  - package: dbt-labs/dbt_utils\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("dbt-packages")
  })

  test("combined project detects multiple technologies", async () => {
    await using tmp = await tmpdir()
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: test\n")
    await fs.writeFile(path.join(tmp.path, "airflow.cfg"), "[core]\n")
    await fs.writeFile(path.join(tmp.path, "databricks.yml"), "bundle:\n  name: test\n")
    const result = await Fingerprint.detect(tmp.path)
    expect(result.tags).toContain("dbt")
    expect(result.tags).toContain("airflow")
    expect(result.tags).toContain("databricks")
    expect(result.tags).toContain("data-engineering")
  })
})

describe("Fingerprint.refresh", () => {
  test("invalidates cache and re-detects new files", async () => {
    await using tmp = await tmpdir()
    // Initial detect — no tags
    const r1 = await Fingerprint.detect(tmp.path)
    expect(r1.tags).toEqual([])
    // Add dbt_project.yml after initial detect
    await fs.writeFile(path.join(tmp.path, "dbt_project.yml"), "name: test\n")
    // refresh() should invalidate cache and pick up the new file
    const r3 = await Fingerprint.refresh()
    expect(r3.tags).toContain("dbt")
  })
})
