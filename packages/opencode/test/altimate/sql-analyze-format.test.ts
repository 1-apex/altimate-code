import { describe, test, expect } from "bun:test"
import { Dispatcher } from "../../src/altimate/native"
import { registerAllSql } from "../../src/altimate/native/sql/register"
import type { SqlAnalyzeResult } from "../../src/altimate/native/types"

// Ensure sql.analyze is registered
registerAllSql()

// ---------------------------------------------------------------------------
// sql.analyze Dispatcher — success semantics and result shape
//
// The AI-5975 fix changed success semantics: finding issues IS a successful
// analysis (success:true). Previously it returned success:false when issues
// were found, causing ~4,000 false "unknown error" telemetry entries per day.
// ---------------------------------------------------------------------------

describe("sql.analyze: success semantics (AI-5975 regression)", () => {
  test("query with lint issues still returns success:true", async () => {
    // SELECT * is a known lint trigger — must still be a successful analysis
    const result = await Dispatcher.call("sql.analyze", {
      sql: "SELECT * FROM users",
      dialect: "snowflake",
    }) as SqlAnalyzeResult
    // KEY INVARIANT: finding issues is a SUCCESSFUL analysis
    expect(result.success).toBe(true)
    // Verify issues were actually found (not a vacuous pass)
    expect(result.issue_count).toBeGreaterThan(0)
    expect(result.confidence).toBe("high")
  })

  test("issue_count matches issues array length", async () => {
    const result = await Dispatcher.call("sql.analyze", {
      sql: "SELECT * FROM orders JOIN customers",
      dialect: "snowflake",
    }) as SqlAnalyzeResult
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.issue_count).toBe(result.issues.length)
  })
})

describe("sql.analyze: issue structure", () => {
  test("lint issues have required fields", async () => {
    const result = await Dispatcher.call("sql.analyze", {
      sql: "SELECT * FROM users",
      dialect: "snowflake",
    }) as SqlAnalyzeResult
    const lintIssues = result.issues.filter((i) => i.type === "lint")
    // Guard against vacuous pass — SELECT * must produce lint findings
    expect(lintIssues.length).toBeGreaterThan(0)
    for (const issue of lintIssues) {
      expect(issue.severity).toBeDefined()
      expect(issue.message).toBeDefined()
      expect(typeof issue.recommendation).toBe("string")
      expect(issue.confidence).toBe("high")
    }
  })

  test("issue types are limited to lint, semantic, safety", async () => {
    const result = await Dispatcher.call("sql.analyze", {
      sql: "SELECT * FROM users WHERE 1=1",
      dialect: "snowflake",
    }) as SqlAnalyzeResult
    expect(result.issues.length).toBeGreaterThan(0)
    const validTypes = ["lint", "semantic", "safety"]
    for (const issue of result.issues) {
      expect(validTypes).toContain(issue.type)
    }
  })
})

describe("sql.analyze: result shape", () => {
  test("successful result has all required properties", async () => {
    const result = await Dispatcher.call("sql.analyze", {
      sql: "SELECT 1 LIMIT 1",
    }) as SqlAnalyzeResult
    expect(result).toHaveProperty("success")
    expect(result).toHaveProperty("issues")
    expect(result).toHaveProperty("issue_count")
    expect(result).toHaveProperty("confidence")
    expect(result).toHaveProperty("confidence_factors")
    expect(Array.isArray(result.issues)).toBe(true)
    expect(Array.isArray(result.confidence_factors)).toBe(true)
  })
})
