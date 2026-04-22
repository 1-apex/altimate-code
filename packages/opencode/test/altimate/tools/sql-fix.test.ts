/**
 * Tests for SqlFixTool — output formatting and Dispatcher integration.
 *
 * Coverage:
 *   1. formatFix — error line, auto-fix section, suggestions section, deduplication of fix SQL.
 *   2. SqlFixTool.execute — title format (pluralisation, auto-fix flag), metadata shape, Dispatcher mock paths.
 */
import { describe, test, expect, spyOn, afterEach, beforeEach } from "bun:test"
import * as Dispatcher from "../../../src/altimate/native/dispatcher"
import { SqlFixTool, _sqlFixInternal as internals } from "../../../src/altimate/tools/sql-fix"
import { SessionID, MessageID } from "../../../src/session/schema"

beforeEach(() => {
  process.env.ALTIMATE_TELEMETRY_DISABLED = "true"
})

afterEach(() => {
  delete process.env.ALTIMATE_TELEMETRY_DISABLED
})

const { formatFix } = internals

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
// formatFix — pure formatting helpers
// ---------------------------------------------------------------------------

describe("formatFix — error line", () => {
  test("always includes the error_message in the output", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      error_message: "syntax error at or near 'FORM'",
      suggestions: [],
      suggestion_count: 0,
    })
    expect(out).toContain("Error: syntax error at or near 'FORM'")
  })
})

describe("formatFix — auto-fix section", () => {
  test("includes '=== Auto-Fixed SQL ===' when fixed_sql is present", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      fixed_sql: "SELECT * FROM users",
      error_message: "syntax error",
      suggestions: [],
      suggestion_count: 0,
    })
    expect(out).toContain("=== Auto-Fixed SQL ===")
    expect(out).toContain("SELECT * FROM users")
  })

  test("does not include auto-fix section when fixed_sql is absent", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      error_message: "syntax error",
      suggestions: [],
      suggestion_count: 0,
    })
    expect(out).not.toContain("=== Auto-Fixed SQL ===")
  })
})

describe("formatFix — suggestions section", () => {
  test("includes '=== Suggestions ===' when suggestions are present", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      error_message: "syntax error",
      suggestions: [
        { type: "syntax", message: "Replace FORM with FROM", confidence: "high" },
      ],
      suggestion_count: 1,
    })
    expect(out).toContain("=== Suggestions ===")
  })

  test("does not include suggestions section when suggestions is empty", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT 1",
      error_message: "unknown error",
      suggestions: [],
      suggestion_count: 0,
    })
    expect(out).not.toContain("=== Suggestions ===")
  })

  test("formats each suggestion with type, confidence, and message", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT a FROM t GROUP BY b",
      error_message: "column 'a' must appear in GROUP BY",
      suggestions: [
        { type: "group_by", message: "Add 'a' to the GROUP BY clause", confidence: "medium" },
      ],
      suggestion_count: 1,
    })
    expect(out).toContain("[group_by]")
    expect(out).toContain("(medium confidence)")
    expect(out).toContain("Add 'a' to the GROUP BY clause")
  })

  test("includes suggestion Fix: line when its fixed_sql differs from the top-level fixed_sql", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      fixed_sql: "SELECT * FROM users",
      error_message: "syntax error",
      suggestions: [
        {
          type: "syntax",
          message: "Replace FORM with FROM",
          confidence: "high",
          fixed_sql: "SELECT * FROM users WHERE active = true",
        },
      ],
      suggestion_count: 1,
    })
    expect(out).toContain("Fix: SELECT * FROM users WHERE active = true")
  })

  test("omits suggestion Fix: line when its fixed_sql is identical to the top-level fixed_sql", () => {
    const sharedFix = "SELECT * FROM users"
    const out = formatFix({
      success: true,
      original_sql: "SELECT * FORM users",
      fixed_sql: sharedFix,
      error_message: "syntax error",
      suggestions: [
        { type: "syntax", message: "Replace FORM with FROM", confidence: "high", fixed_sql: sharedFix },
      ],
      suggestion_count: 1,
    })
    // The fix is already shown in the auto-fix section; no need to repeat it.
    const suggestionBlock = out.split("=== Suggestions ===")[1] ?? ""
    expect(suggestionBlock).not.toContain("Fix: SELECT * FROM users")
  })

  test("renders multiple suggestions in order", () => {
    const out = formatFix({
      success: true,
      original_sql: "SELECT a, b FROM t",
      error_message: "ambiguous column 'a'",
      suggestions: [
        { type: "alias", message: "Qualify 'a' with table alias", confidence: "high" },
        { type: "schema", message: "Check the column name in information_schema", confidence: "low" },
      ],
      suggestion_count: 2,
    })
    const aliasIdx = out.indexOf("[alias]")
    const schemaIdx = out.indexOf("[schema]")
    expect(aliasIdx).toBeGreaterThanOrEqual(0)
    expect(schemaIdx).toBeGreaterThan(aliasIdx)
  })
})

// ---------------------------------------------------------------------------
// SqlFixTool.execute — Dispatcher integration
// ---------------------------------------------------------------------------

describe("SqlFixTool.execute", () => {
  let spy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    spy?.mockRestore()
    spy = undefined
  })

  function mockDispatcher(response: unknown) {
    spy?.mockRestore()
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => response as never)
  }

  test("title is 'Fix: N suggestions + auto-fix' when fixed_sql is present", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT * FORM users",
      fixed_sql: "SELECT * FROM users",
      error_message: "syntax error",
      suggestions: [{ type: "syntax", message: "Fix typo", confidence: "high" }],
      suggestion_count: 1,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT * FORM users", error_message: "syntax error" },
      ctx as any,
    )
    expect(result.title).toBe("Fix: 1 suggestion + auto-fix")
  })

  test("title uses plural 'suggestions' for counts > 1", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT a FORM t",
      fixed_sql: "SELECT a FROM t",
      error_message: "syntax error",
      suggestions: [
        { type: "syntax", message: "s1", confidence: "high" },
        { type: "schema", message: "s2", confidence: "low" },
      ],
      suggestion_count: 2,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT a FORM t", error_message: "syntax error" },
      ctx as any,
    )
    expect(result.title).toContain("2 suggestions")
  })

  test("title has no '+ auto-fix' when fixed_sql is absent", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT 1",
      error_message: "some error",
      suggestions: [{ type: "hint", message: "Check the query", confidence: "low" }],
      suggestion_count: 1,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", error_message: "some error" },
      ctx as any,
    )
    expect(result.title).not.toContain("auto-fix")
    expect(result.title).toContain("1 suggestion")
  })

  test("title is 'Fix: ERROR' and output contains the message when dispatcher throws", async () => {
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => {
      throw new Error("dispatcher unavailable")
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", error_message: "some error" },
      ctx as any,
    )
    expect(result.title).toBe("Fix: ERROR")
    expect(result.metadata.success).toBe(false)
    expect(String(result.output)).toContain("dispatcher unavailable")
  })

  test("metadata.has_fix is true when fixed_sql is present", async () => {
    mockDispatcher({
      success: true,
      original_sql: "BAD SQL",
      fixed_sql: "SELECT 1",
      error_message: "error",
      suggestions: [],
      suggestion_count: 0,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "BAD SQL", error_message: "error" },
      ctx as any,
    )
    expect(result.metadata.has_fix).toBe(true)
  })

  test("metadata.has_fix is false when fixed_sql is absent", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT 1",
      error_message: "error",
      suggestions: [],
      suggestion_count: 0,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", error_message: "error" },
      ctx as any,
    )
    expect(result.metadata.has_fix).toBe(false)
  })

  test("metadata.suggestion_count reflects the dispatcher result", async () => {
    mockDispatcher({
      success: true,
      original_sql: "SELECT 1",
      error_message: "error",
      suggestions: [
        { type: "a", message: "m1", confidence: "high" },
        { type: "b", message: "m2", confidence: "low" },
      ],
      suggestion_count: 2,
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", error_message: "error" },
      ctx as any,
    )
    expect(result.metadata.suggestion_count).toBe(2)
  })

  test("metadata includes error field when dispatcher result has error", async () => {
    mockDispatcher({
      success: false,
      original_sql: "GARBAGE",
      error_message: "parse failed",
      suggestions: [],
      suggestion_count: 0,
      error: "Could not parse query",
    })
    const tool = await SqlFixTool.init()
    const result = await tool.execute(
      { sql: "GARBAGE", error_message: "parse failed" },
      ctx as any,
    )
    expect((result.metadata as any).error).toBe("Could not parse query")
  })
})
