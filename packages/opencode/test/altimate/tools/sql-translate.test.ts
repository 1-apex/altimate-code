/**
 * Tests for SqlTranslateTool — output formatting and Dispatcher integration.
 *
 * Coverage:
 *   1. formatTranslation — success/failure output structure, warnings, missing fields.
 *   2. SqlTranslateTool.execute — title format, metadata shape, Dispatcher mock paths.
 */
import { describe, test, expect, spyOn, afterEach, beforeEach } from "bun:test"
import * as Dispatcher from "../../../src/altimate/native/dispatcher"
import { SqlTranslateTool, _sqlTranslateInternal as internals } from "../../../src/altimate/tools/sql-translate"
import { SessionID, MessageID } from "../../../src/session/schema"

beforeEach(() => {
  process.env.ALTIMATE_TELEMETRY_DISABLED = "true"
})

afterEach(() => {
  delete process.env.ALTIMATE_TELEMETRY_DISABLED
})

const { formatTranslation } = internals

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
// formatTranslation — pure formatting (no I/O)
// ---------------------------------------------------------------------------

describe("formatTranslation — failure", () => {
  test("returns Translation failed with the error message", () => {
    const result = formatTranslation(
      { success: false, error: "Unsupported syntax", source_dialect: "mysql", target_dialect: "bigquery", warnings: [] },
      "SELECT 1",
    )
    expect(result).toBe("Translation failed: Unsupported syntax")
  })

  test("falls back to Unknown error when error field is absent", () => {
    const result = formatTranslation(
      { success: false, source_dialect: "mysql", target_dialect: "bigquery", warnings: [] },
      "SELECT 1",
    )
    expect(result).toBe("Translation failed: Unknown error")
  })
})

describe("formatTranslation — success", () => {
  const base = {
    success: true,
    source_dialect: "snowflake",
    target_dialect: "postgres",
    translated_sql: "SELECT id FROM users",
    warnings: [] as string[],
  }

  test("includes source and target dialect headers", () => {
    const out = formatTranslation(base, "SELECT ID FROM USERS")
    expect(out).toContain("Source dialect: snowflake")
    expect(out).toContain("Target dialect: postgres")
  })

  test("includes the trimmed original SQL under its section header", () => {
    const out = formatTranslation(base, "  SELECT ID FROM USERS  ")
    expect(out).toContain("--- Original SQL ---")
    expect(out).toContain("SELECT ID FROM USERS")
  })

  test("includes the translated SQL under its section header", () => {
    const out = formatTranslation(base, "SELECT ID FROM USERS")
    expect(out).toContain("--- Translated SQL ---")
    expect(out).toContain("SELECT id FROM users")
  })

  test("does not include a warnings section when warnings is empty", () => {
    const out = formatTranslation(base, "SELECT 1")
    expect(out).not.toContain("--- Warnings ---")
  })

  test("includes a warnings section with ! prefix for each warning", () => {
    const out = formatTranslation(
      { ...base, warnings: ["ILIKE is not supported in postgres", "NVL replaced with COALESCE"] },
      "SELECT 1",
    )
    expect(out).toContain("--- Warnings ---")
    expect(out).toContain("  ! ILIKE is not supported in postgres")
    expect(out).toContain("  ! NVL replaced with COALESCE")
  })

  test("uses 'unknown' when source_dialect is missing", () => {
    const out = formatTranslation(
      { success: true, target_dialect: "postgres", translated_sql: "SELECT 1", warnings: [] } as any,
      "SELECT 1",
    )
    expect(out).toContain("Source dialect: unknown")
  })

  test("uses 'unknown' when target_dialect is missing", () => {
    const out = formatTranslation(
      { success: true, source_dialect: "snowflake", translated_sql: "SELECT 1", warnings: [] } as any,
      "SELECT 1",
    )
    expect(out).toContain("Target dialect: unknown")
  })

  test("uses empty string when translated_sql is absent", () => {
    const out = formatTranslation(
      { success: true, source_dialect: "snowflake", target_dialect: "postgres", warnings: [] },
      "SELECT 1",
    )
    // The translated section header should still appear; the body line should be blank.
    expect(out).toContain("--- Translated SQL ---")
  })
})

// ---------------------------------------------------------------------------
// SqlTranslateTool.execute — Dispatcher integration
// ---------------------------------------------------------------------------

describe("SqlTranslateTool.execute", () => {
  let spy: ReturnType<typeof spyOn> | undefined

  afterEach(() => {
    spy?.mockRestore()
    spy = undefined
  })

  function mockDispatcher(response: unknown) {
    spy?.mockRestore()
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => response as never)
  }

  test("title is '<source> → <target> [OK]' on success", async () => {
    mockDispatcher({
      success: true,
      source_dialect: "snowflake",
      target_dialect: "postgres",
      translated_sql: "SELECT id FROM users",
      warnings: [],
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT ID FROM USERS", source_dialect: "snowflake", target_dialect: "postgres" },
      ctx as any,
    )
    expect(result.title).toBe("Translate: snowflake → postgres [OK]")
  })

  test("title is '<source> → <target> [FAIL]' when dispatcher returns success=false", async () => {
    mockDispatcher({
      success: false,
      source_dialect: "mysql",
      target_dialect: "bigquery",
      warnings: [],
      error: "Unsupported construct",
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "mysql", target_dialect: "bigquery" },
      ctx as any,
    )
    expect(result.title).toBe("Translate: mysql → bigquery [FAIL]")
  })

  test("title is 'Translate: ERROR' when dispatcher throws", async () => {
    spy = spyOn(Dispatcher, "call").mockImplementation(async () => {
      throw new Error("network failure")
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "snowflake", target_dialect: "duckdb" },
      ctx as any,
    )
    expect(result.title).toBe("Translate: ERROR")
    expect(result.metadata.success).toBe(false)
    expect(String(result.output)).toContain("network failure")
  })

  test("metadata reflects warningCount from result.warnings", async () => {
    mockDispatcher({
      success: true,
      source_dialect: "snowflake",
      target_dialect: "postgres",
      translated_sql: "SELECT 1",
      warnings: ["w1", "w2", "w3"],
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "snowflake", target_dialect: "postgres" },
      ctx as any,
    )
    expect(result.metadata.warningCount).toBe(3)
  })

  test("metadata.warningCount is 0 when warnings is empty", async () => {
    mockDispatcher({
      success: true,
      source_dialect: "redshift",
      target_dialect: "duckdb",
      translated_sql: "SELECT 1",
      warnings: [],
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "redshift", target_dialect: "duckdb" },
      ctx as any,
    )
    expect(result.metadata.warningCount).toBe(0)
  })

  test("metadata includes error field when dispatcher returns an error", async () => {
    mockDispatcher({
      success: false,
      source_dialect: "mysql",
      target_dialect: "postgres",
      warnings: [],
      error: "Parse failed",
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "mysql", target_dialect: "postgres" },
      ctx as any,
    )
    expect((result.metadata as any).error).toBe("Parse failed")
  })

  test("metadata does not include error field on clean success", async () => {
    mockDispatcher({
      success: true,
      source_dialect: "snowflake",
      target_dialect: "postgres",
      translated_sql: "SELECT 1",
      warnings: [],
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "snowflake", target_dialect: "postgres" },
      ctx as any,
    )
    expect("error" in result.metadata).toBe(false)
  })

  test("uses args dialects in title even when dispatcher omits them", async () => {
    // dispatcher returns null/undefined dialects — title must still use the args values
    mockDispatcher({
      success: true,
      source_dialect: undefined,
      target_dialect: undefined,
      translated_sql: "SELECT 1",
      warnings: [],
    })
    const tool = await SqlTranslateTool.init()
    const result = await tool.execute(
      { sql: "SELECT 1", source_dialect: "hive", target_dialect: "spark" },
      ctx as any,
    )
    expect(result.title).toContain("hive")
    expect(result.title).toContain("spark")
  })
})
