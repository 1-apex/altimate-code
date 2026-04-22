/**
 * Tests for SqlOptimizeTool — output formatting and Dispatcher integration.
 *
 * Coverage:
 *   1. impactBadge — maps impact strings to display labels.
 *   2. formatSuggestion — index numbering, badge, before/after lines.
 *   3. formatOptimization — parse-failure path, clean query path, suggestion grouping by
 *      impact, anti-pattern rendering (location, confidence), optimized-SQL section.
 *   4. SqlOptimizeTool.execute — title format, metadata shape (findings, has_schema),
 *      Dispatcher mock paths.
 */
import { describe, test, expect, spyOn, afterEach, beforeEach } from "bun:test"
import * as Dispatcher from "../../../src/altimate/native/dispatcher"
import { SqlOptimizeTool, _sqlOptimizeInternal as internals } from "../../../src/altimate/tools/sql-optimize"
import type { SqlOptimizeResult } from "../../../src/altimate/native/types"
import { SessionID, MessageID } from "../../../src/session/schema"

beforeEach(() => {
  process.env.ALTIMATE_TELEMETRY_DISABLED = "true"
})

afterEach(() => {
  delete process.env.ALTIMATE_TELEMETRY_DISABLED
})

const { impactBadge, formatSuggestion, formatOptimization } = internals

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

// ---------------------------------------------------------------------------
// impactBadge
// ---------------------------------------------------------------------------

describe("impactBadge", () => {
  test("'high' → 'HIGH'", () => expect(impactBadge("high")).toBe("HIGH"))
  test("'medium' → 'MED'", () => expect(impactBadge("medium")).toBe("MED"))
  test("'low' → 'LOW'", () => expect(impactBadge("low")).toBe("LOW"))
  test("unknown values are uppercased verbatim", () => expect(impactBadge("critical")).toBe("CRITICAL"))
  test("empty string → empty string", () => expect(impactBadge("")).toBe(""))
})

// ---------------------------------------------------------------------------
// formatSuggestion
// ---------------------------------------------------------------------------

describe("formatSuggestion", () => {
  const base = { type: "REWRITE", description: "Use EXISTS instead of COUNT", impact: "high" }

  test("first line starts with 1-based index number", () => {
    const lines = formatSuggestion(base, 0)
    expect(lines[0]).toMatch(/^\s+1\./)
  })

  test("index 4 → '5.'", () => {
    const lines = formatSuggestion(base, 4)
    expect(lines[0]).toContain("5.")
  })

  test("first line includes the impact badge", () => {
    const lines = formatSuggestion(base, 0)
    expect(lines[0]).toContain("[HIGH]")
  })

  test("first line includes the type and description", () => {
    const lines = formatSuggestion(base, 0)
    expect(lines[0]).toContain("REWRITE")
    expect(lines[0]).toContain("Use EXISTS instead of COUNT")
  })

  test("includes 'Before:' line when before is present", () => {
    const lines = formatSuggestion({ ...base, before: "SELECT COUNT(*) FROM t WHERE x = 1" }, 0)
    expect(lines.some((l) => l.includes("Before:"))).toBe(true)
  })

  test("includes 'After:' line when after is present", () => {
    const lines = formatSuggestion({ ...base, after: "SELECT 1 WHERE EXISTS (SELECT 1 FROM t WHERE x = 1)" }, 0)
    expect(lines.some((l) => l.includes("After:"))).toBe(true)
  })

  test("omits Before/After lines when they are absent", () => {
    const lines = formatSuggestion(base, 0)
    expect(lines.some((l) => l.includes("Before:"))).toBe(false)
    expect(lines.some((l) => l.includes("After:"))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatOptimization
// ---------------------------------------------------------------------------

const successBase: SqlOptimizeResult = {
  success: true,
  original_sql: "SELECT * FROM orders",
  suggestions: [],
  anti_patterns: [],
  confidence: "high",
}

describe("formatOptimization — failure path", () => {
  test("returns 'Optimization failed: <error>' on parse failure", () => {
    const out = formatOptimization({ ...successBase, success: false, error: "Parse error on line 3" })
    expect(out).toBe("Optimization failed: Parse error on line 3")
  })

  test("falls back to 'Unknown error' when error field is absent", () => {
    const out = formatOptimization({ ...successBase, success: false })
    expect(out).toBe("Optimization failed: Unknown error")
  })
})

describe("formatOptimization — clean query", () => {
  test("returns the 'looks good' message when there are no findings", () => {
    const out = formatOptimization(successBase)
    expect(out).toContain("No optimization opportunities found")
    expect(out).toContain("query looks good")
  })
})

describe("formatOptimization — suggestions", () => {
  const withSuggestions: SqlOptimizeResult = {
    ...successBase,
    suggestions: [
      { type: "INDEX_HINT", description: "Add index on orders.status", impact: "high" },
      { type: "REWRITE", description: "Avoid SELECT *", impact: "medium" },
      { type: "STRUCTURE", description: "Move filter to subquery", impact: "low" },
    ],
    anti_patterns: [],
    confidence: "medium",
  }

  test("includes the '=== Suggestions ===' section header", () => {
    expect(formatOptimization(withSuggestions)).toContain("=== Suggestions ===")
  })

  test("summary line shows correct suggestion and anti-pattern counts", () => {
    const out = formatOptimization(withSuggestions)
    expect(out).toContain("3 optimization suggestions")
    expect(out).toContain("0 anti-patterns")
  })

  test("groups suggestions under High / Medium / Low Impact sub-headers", () => {
    const out = formatOptimization(withSuggestions)
    expect(out).toContain("High Impact:")
    expect(out).toContain("Medium Impact:")
    expect(out).toContain("Low Impact:")
  })

  test("high-impact items appear before medium-impact items", () => {
    const out = formatOptimization(withSuggestions)
    expect(out.indexOf("High Impact:")).toBeLessThan(out.indexOf("Medium Impact:"))
  })

  test("medium-impact items appear before low-impact items", () => {
    const out = formatOptimization(withSuggestions)
    expect(out.indexOf("Medium Impact:")).toBeLessThan(out.indexOf("Low Impact:"))
  })

  test("omits Medium Impact sub-header when there are no medium items", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [{ type: "INDEX_HINT", description: "Add index", impact: "high" }],
      anti_patterns: [],
    })
    expect(out).not.toContain("Medium Impact:")
    expect(out).not.toContain("Low Impact:")
  })

  test("'1 optimization suggestion' is singular", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [{ type: "REWRITE", description: "Simplify JOIN", impact: "high" }],
      anti_patterns: [],
    })
    expect(out).toContain("1 optimization suggestion")
    expect(out).not.toContain("1 optimization suggestions")
  })
})

describe("formatOptimization — optimized SQL section", () => {
  test("includes '=== Optimized SQL ===' when optimized_sql is present", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [{ type: "REWRITE", description: "Simplified", impact: "high" }],
      anti_patterns: [],
      optimized_sql: "SELECT id FROM orders WHERE status = 'active'",
    })
    expect(out).toContain("=== Optimized SQL ===")
    expect(out).toContain("SELECT id FROM orders WHERE status = 'active'")
  })

  test("omits optimized SQL section when optimized_sql is absent", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [{ type: "REWRITE", description: "Simplify", impact: "medium" }],
      anti_patterns: [],
    })
    expect(out).not.toContain("=== Optimized SQL ===")
  })
})

describe("formatOptimization — anti-patterns", () => {
  const withAntiPattern: SqlOptimizeResult = {
    ...successBase,
    suggestions: [],
    anti_patterns: [
      {
        type: "SELECT_STAR",
        severity: "warning",
        message: "Avoid SELECT * in production queries",
        recommendation: "Explicitly list the required columns",
        confidence: "high",
      },
    ],
  }

  test("includes '=== Anti-Patterns Detected ===' section header", () => {
    expect(formatOptimization(withAntiPattern)).toContain("=== Anti-Patterns Detected ===")
  })

  test("renders the anti-pattern type and severity badge", () => {
    const out = formatOptimization(withAntiPattern)
    expect(out).toContain("[WARNING]")
    expect(out).toContain("SELECT_STAR")
  })

  test("renders the message and recommendation", () => {
    const out = formatOptimization(withAntiPattern)
    expect(out).toContain("Avoid SELECT * in production queries")
    expect(out).toContain("Explicitly list the required columns")
  })

  test("includes location when present", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [],
      anti_patterns: [
        {
          type: "CROSS_JOIN",
          severity: "error",
          message: "Implicit cross join detected",
          recommendation: "Use explicit JOIN syntax",
          location: "line 4, col 12",
          confidence: "high",
        },
      ],
    })
    expect(out).toContain("line 4, col 12")
  })

  test("omits location segment when location is absent", () => {
    const out = formatOptimization(withAntiPattern)
    // The em-dash separator only appears with a location
    expect(out).not.toContain(" — line")
  })

  test("includes confidence badge for non-high confidence", () => {
    const out = formatOptimization({
      ...successBase,
      suggestions: [],
      anti_patterns: [
        {
          type: "N_PLUS_ONE",
          severity: "warning",
          message: "Possible N+1 query pattern",
          recommendation: "Batch your queries",
          confidence: "medium",
        },
      ],
    })
    expect(out).toContain("[medium confidence]")
  })

  test("omits confidence badge for high-confidence findings", () => {
    const out = formatOptimization(withAntiPattern)
    expect(out).not.toContain("confidence]")
  })

  test("'1 anti-pattern' is singular", () => {
    const out = formatOptimization(withAntiPattern)
    expect(out).toContain("1 anti-pattern")
    expect(out).not.toContain("1 anti-patterns")
  })
})

// ---------------------------------------------------------------------------
// SqlOptimizeTool.execute — Dispatcher integration
// ---------------------------------------------------------------------------

describe("SqlOptimizeTool.execute", () => {
  let spy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    spy?.mockRestore()
    spy = undefined
  })

  function mockDispatcher(response: unknown) {
    spy?.mockRestore()
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => response as never)
  }

  test("title format on clean success: 'Optimize: N suggestions, M anti-patterns [confidence]'", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT * FROM orders",
      suggestions: [{ type: "REWRITE", description: "Avoid SELECT *", impact: "medium" }],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT * FROM orders" }, ctx as any)
    expect(result.title).toBe("Optimize: 1 suggestion, 0 anti-patterns [high]")
  })

  test("title uses 'PARSE ERROR' when dispatcher returns success=false", async () => {
    mockDispatcher({
      success: false,
      original_sql: "GARBAGE SQL",
      suggestions: [],
      anti_patterns: [],
      confidence: "low",
      error: "Unable to parse",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "GARBAGE SQL" }, ctx as any)
    expect(result.title).toContain("PARSE ERROR")
  })

  test("title is 'Optimize: ERROR' when dispatcher throws", async () => {
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => {
      throw new Error("connection refused")
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT 1" }, ctx as any)
    expect(result.title).toBe("Optimize: ERROR")
    expect(result.metadata.success).toBe(false)
    expect(String(result.output)).toContain("connection refused")
  })

  test("metadata.findings is populated from anti_patterns and suggestions", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT * FROM t",
      suggestions: [{ type: "REWRITE", description: "Avoid SELECT *", impact: "high" }],
      anti_patterns: [
        { type: "SELECT_STAR", severity: "warning", message: "msg", recommendation: "rec", confidence: "high" },
      ],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT * FROM t" }, ctx as any)
    const findings = (result.metadata as any).findings as Array<{ category: string }>
    expect(Array.isArray(findings)).toBe(true)
    expect(findings.some((f) => f.category === "SELECT_STAR")).toBe(true)
    expect(findings.some((f) => f.category === "REWRITE")).toBe(true)
  })

  test("metadata.findings is absent when there are no anti_patterns or suggestions", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT 1",
      suggestions: [],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT 1" }, ctx as any)
    expect("findings" in result.metadata).toBe(false)
  })

  test("metadata.has_schema is true when schema_context is provided", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT id FROM users",
      suggestions: [],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute(
      { sql: "SELECT id FROM users", schema_context: { users: { id: "INT" } } },
      ctx as any,
    )
    expect(result.metadata.has_schema).toBe(true)
  })

  test("metadata.has_schema is false when schema_context is omitted", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT id FROM users",
      suggestions: [],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT id FROM users" }, ctx as any)
    expect(result.metadata.has_schema).toBe(false)
  })

  test("metadata.hasOptimizedSql is true when optimized_sql is returned", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT * FROM t",
      optimized_sql: "SELECT id FROM t",
      suggestions: [{ type: "REWRITE", description: "Avoid SELECT *", impact: "high" }],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT * FROM t" }, ctx as any)
    expect(result.metadata.hasOptimizedSql).toBe(true)
  })

  test("metadata.dialect reflects the argument passed in", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT 1",
      suggestions: [],
      anti_patterns: [],
      confidence: "high",
    })
    const tool = await SqlOptimizeTool.init()
    const result = await tool.execute({ sql: "SELECT 1", dialect: "bigquery" }, ctx as any)
    expect(result.metadata.dialect).toBe("bigquery")
  })
})
