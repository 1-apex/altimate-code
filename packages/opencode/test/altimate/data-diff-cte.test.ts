/**
 * Tests for CTE wrapping and injection in SQL-query mode.
 *
 * The tricky case is cross-warehouse comparison where source and target are both
 * SQL queries referencing tables that only exist on their own side. The combined
 * CTE prefix cannot be sent to both warehouses because T-SQL / Fabric parse-bind
 * every CTE body even when unreferenced — the "other side" CTE would fail to
 * resolve its base table.
 */
import { describe, test, expect } from "bun:test"

import { resolveTableSources, injectCte } from "../../src/altimate/native/connections/data-diff"

describe("resolveTableSources", () => {
  test("plain table names pass through without wrapping", () => {
    const r = resolveTableSources("orders", "orders_v2")
    expect(r.table1Name).toBe("orders")
    expect(r.table2Name).toBe("orders_v2")
    expect(r.ctePrefix).toBeNull()
    expect(r.sourceCtePrefix).toBeNull()
    expect(r.targetCtePrefix).toBeNull()
  })

  test("schema-qualified plain names pass through", () => {
    const r = resolveTableSources("gold.dim_customer", "TRANSFORMED.DimCustomer")
    expect(r.table1Name).toBe("gold.dim_customer")
    expect(r.table2Name).toBe("TRANSFORMED.DimCustomer")
    expect(r.ctePrefix).toBeNull()
  })

  test("both queries are wrapped in CTEs with aliases", () => {
    const r = resolveTableSources(
      "SELECT id, val FROM [TRANSFORMED].[DimCustomer]",
      "SELECT id, val FROM [gold].[dim_customer]",
    )
    expect(r.table1Name).toBe("__diff_source")
    expect(r.table2Name).toBe("__diff_target")
    expect(r.ctePrefix).toContain("__diff_source AS (")
    expect(r.ctePrefix).toContain("__diff_target AS (")
    expect(r.ctePrefix).toContain("[TRANSFORMED].[DimCustomer]")
    expect(r.ctePrefix).toContain("[gold].[dim_customer]")
  })

  test("side-specific prefixes contain only the relevant CTE", () => {
    const r = resolveTableSources(
      "SELECT id FROM [TRANSFORMED].[DimCustomer]",
      "SELECT id FROM [gold].[dim_customer]",
    )
    // Source prefix has source table only — must not leak target table ref
    expect(r.sourceCtePrefix).toContain("__diff_source AS (")
    expect(r.sourceCtePrefix).toContain("[TRANSFORMED].[DimCustomer]")
    expect(r.sourceCtePrefix).not.toContain("__diff_target")
    expect(r.sourceCtePrefix).not.toContain("[gold].[dim_customer]")

    // Target prefix has target table only — must not leak source table ref
    expect(r.targetCtePrefix).toContain("__diff_target AS (")
    expect(r.targetCtePrefix).toContain("[gold].[dim_customer]")
    expect(r.targetCtePrefix).not.toContain("__diff_source")
    expect(r.targetCtePrefix).not.toContain("[TRANSFORMED].[DimCustomer]")
  })

  test("mixed: plain source + query target still wraps both sides", () => {
    const r = resolveTableSources(
      "orders",
      "SELECT * FROM other.orders WHERE region = 'EU'",
    )
    expect(r.table1Name).toBe("__diff_source")
    expect(r.table2Name).toBe("__diff_target")
    // Plain table wrapped with ANSI double-quoted identifiers
    expect(r.sourceCtePrefix).toContain('SELECT * FROM "orders"')
    expect(r.targetCtePrefix).toContain("other.orders")
  })

  test("dialect-aware quoting: tsql uses square brackets", () => {
    // Fix #4: plain table names wrapped inside CTEs must use the side's
    // native quoting. `"schema"."table"` fails on MSSQL with QUOTED_IDENTIFIER OFF.
    const r = resolveTableSources(
      "dbo.orders",
      "SELECT * FROM base",
      "tsql",
      "postgres",
    )
    expect(r.sourceCtePrefix).toContain("[dbo].[orders]")
    expect(r.sourceCtePrefix).not.toContain('"dbo"."orders"')
  })

  test("dialect-aware quoting: fabric uses square brackets; mysql uses backticks", () => {
    // Pair the plain-table side with a SQL-query counterpart to force CTE wrapping.
    const fabric = resolveTableSources(
      "gold.dim_customer",
      "SELECT * FROM other",
      "fabric",
      "fabric",
    )
    expect(fabric.sourceCtePrefix).toContain("[gold].[dim_customer]")

    const mysql = resolveTableSources(
      "SELECT 1 AS id",
      "db.orders",
      "mysql",
      "mysql",
    )
    expect(mysql.targetCtePrefix).toContain("`db`.`orders`")
  })

  test("query detection requires both keyword AND whitespace", () => {
    // A table literally named "select" should NOT be treated as a query
    const r = resolveTableSources("select", "with")
    expect(r.table1Name).toBe("select")
    expect(r.table2Name).toBe("with")
    expect(r.ctePrefix).toBeNull()
  })
})

describe("injectCte", () => {
  test("prepends CTE prefix to a plain SELECT", () => {
    const prefix = "WITH __diff_source AS (\nSELECT 1 AS id\n)"
    const sql = "SELECT COUNT(*) FROM __diff_source"
    const out = injectCte(sql, prefix)
    expect(out.startsWith(prefix)).toBe(true)
    expect(out).toContain("SELECT COUNT(*) FROM __diff_source")
  })

  test("merges with an engine-emitted WITH clause", () => {
    const prefix = "WITH __diff_source AS (\nSELECT * FROM base\n)"
    const engineSql = "WITH engine_cte AS (SELECT id FROM __diff_source) SELECT * FROM engine_cte"
    const out = injectCte(engineSql, prefix)
    // Must start with a single WITH, with our CTE first, then engine's
    expect(out.match(/^WITH /)).not.toBeNull()
    expect((out.match(/\bWITH\b/g) ?? []).length).toBe(1)
    expect(out.indexOf("__diff_source AS")).toBeLessThan(out.indexOf("engine_cte AS"))
  })

  test("side-specific injection: source prefix does not leak target refs", () => {
    // Simulates cross-warehouse fp1_1 task going to MSSQL. It must not see any
    // reference to the Fabric-only target table, since MSSQL parse-binds every
    // CTE body.
    const r = resolveTableSources(
      "SELECT id FROM [TRANSFORMED].[DimCustomer]",
      "SELECT id FROM [gold].[dim_customer]",
    )
    const engineFp1Sql =
      "SELECT COUNT(*), SUM(CAST(...HASHBYTES('MD5', CONCAT(CAST([id] AS NVARCHAR(MAX))))...)) FROM [__diff_source]"
    const sqlForMssql = injectCte(engineFp1Sql, r.sourceCtePrefix!)
    expect(sqlForMssql).toContain("[TRANSFORMED].[DimCustomer]")
    expect(sqlForMssql).not.toContain("[gold].[dim_customer]")
    expect(sqlForMssql).not.toContain("__diff_target")
  })

  test("side-specific injection: target prefix does not leak source refs", () => {
    const r = resolveTableSources(
      "SELECT id FROM [TRANSFORMED].[DimCustomer]",
      "SELECT id FROM [gold].[dim_customer]",
    )
    const engineFp2Sql = "SELECT COUNT(*) FROM [__diff_target]"
    const sqlForFabric = injectCte(engineFp2Sql, r.targetCtePrefix!)
    expect(sqlForFabric).toContain("[gold].[dim_customer]")
    expect(sqlForFabric).not.toContain("[TRANSFORMED].[DimCustomer]")
    expect(sqlForFabric).not.toContain("__diff_source")
  })
})
