/**
 * Performance Regression Tests — Feature Discovery
 *
 * Ensures that post-connect suggestions, progressive disclosure hints,
 * telemetry tracking, and approval phrase detection stay within tight
 * performance budgets. All operations here are pure computation (no I/O),
 * so generous thresholds are used to prevent CI flakes.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { Telemetry } from "../../src/telemetry"
import { PostConnectSuggestions } from "../../src/altimate/tools/post-connect-suggestions"

// ---------------------------------------------------------------------------
// Capture telemetry via spyOn instead of mock.module to avoid
// Bun's process-global mock.module leaking into other test files.
// ---------------------------------------------------------------------------
const trackedEvents: any[] = []

beforeEach(() => {
  trackedEvents.length = 0
  PostConnectSuggestions.resetShownSuggestions()
  spyOn(Telemetry, "track").mockImplementation((event: any) => {
    trackedEvents.push(event)
  })
  spyOn(Telemetry, "getContext").mockReturnValue({
    sessionId: "perf-test-session",
    projectId: "",
  } as any)
})

afterEach(() => {
  mock.restore()
})

// ===========================================================================
// Performance: suggestions overhead
// ===========================================================================

describe("performance: suggestions overhead", () => {
  test("getPostConnectSuggestions completes 1000 iterations in < 50ms", () => {
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      PostConnectSuggestions.getPostConnectSuggestions({
        warehouseType: "snowflake",
        schemaIndexed: false,
        dbtDetected: true,
        connectionCount: 3,
        toolsUsedInSession: ["sql_execute", "sql_analyze"],
      })
    }
    const elapsed = performance.now() - start
    // 1000 iterations of pure string concat should be well under 50ms
    expect(elapsed).toBeLessThan(50)
  })

  test("getPostConnectSuggestions with schema indexed (fewer branches) is fast", () => {
    const start = performance.now()
    for (let i = 0; i < 1000; i++) {
      PostConnectSuggestions.getPostConnectSuggestions({
        warehouseType: "postgres",
        schemaIndexed: true,
        dbtDetected: false,
        connectionCount: 1,
        toolsUsedInSession: [],
      })
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  test("getProgressiveSuggestion completes 10000 lookups in < 50ms", () => {
    const tools = ["sql_execute", "sql_analyze", "schema_inspect", "schema_index", "warehouse_add", "unknown_tool"]
    const start = performance.now()
    for (let i = 0; i < 10000; i++) {
      PostConnectSuggestions.getProgressiveSuggestion(tools[i % tools.length])
    }
    const elapsed = performance.now() - start
    // 10k lookups in a Record<string, string> should be trivial
    expect(elapsed).toBeLessThan(50)
  })

  test("getProgressiveSuggestion returns correct result on first call and null after (dedup)", () => {
    // First call returns suggestion
    const first = PostConnectSuggestions.getProgressiveSuggestion("sql_execute")
    expect(first).not.toBeNull()
    expect(first).toContain("sql_analyze")

    // Subsequent calls return null due to deduplication
    const second = PostConnectSuggestions.getProgressiveSuggestion("sql_execute")
    expect(second).toBeNull()

    // Different tool still works
    const other = PostConnectSuggestions.getProgressiveSuggestion("sql_analyze")
    expect(other).not.toBeNull()
    expect(other).toContain("schema_inspect")
  })

  test("getProgressiveSuggestion with reset is fast across iterations", () => {
    const start = performance.now()
    for (let i = 0; i < 5000; i++) {
      PostConnectSuggestions.resetShownSuggestions()
      PostConnectSuggestions.getProgressiveSuggestion("sql_execute")
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(50)
  })

  test("trackSuggestions does not throw and completes 100 calls quickly", () => {
    const start = performance.now()
    for (let i = 0; i < 100; i++) {
      PostConnectSuggestions.trackSuggestions({
        suggestionType: "progressive_disclosure",
        suggestionsShown: ["sql_analyze"],
        warehouseType: "snowflake",
      })
    }
    const elapsed = performance.now() - start
    // 100 telemetry calls (to a mock) should be very fast
    expect(elapsed).toBeLessThan(500)
    expect(trackedEvents.length).toBe(100)
  })

  test("trackSuggestions with all suggestion types stays fast", () => {
    const types: Array<"post_warehouse_connect" | "dbt_detected" | "progressive_disclosure"> = [
      "post_warehouse_connect",
      "dbt_detected",
      "progressive_disclosure",
    ]
    const start = performance.now()
    for (let i = 0; i < 300; i++) {
      PostConnectSuggestions.trackSuggestions({
        suggestionType: types[i % types.length],
        suggestionsShown: ["schema_index", "sql_analyze"],
        warehouseType: i % 2 === 0 ? "snowflake" : "postgres",
      })
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(500)
    expect(trackedEvents.length).toBe(300)
  })
})

// ===========================================================================
// Performance: plan approval phrase detection
// ===========================================================================

describe("performance: plan approval phrase detection", () => {
  const approvalPhrases = ["looks good", "proceed", "approved", "approve", "lgtm", "go ahead", "ship it", "yes", "perfect"]
  const rejectionPhrases = ["don't", "stop", "reject", "not good", "undo", "abort", "start over", "wrong"]
  const rejectionWords = ["no"]

  test("approval detection completes 100k iterations in < 200ms", () => {
    const testText = "this looks good, let's proceed with the implementation"

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      const isRejectionPhrase = rejectionPhrases.some((p) => testText.includes(p))
      const isRejectionWord = rejectionWords.some((w) => new RegExp(`\\b${w}\\b`).test(testText))
      const isRejection = isRejectionPhrase || isRejectionWord
      const isApproval = !isRejection && approvalPhrases.some((p) => testText.includes(p))
      if (isApproval === undefined) throw new Error("unreachable")
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  test("rejection detection is fast (short-circuits on first match)", () => {
    const testText = "no, I don't think this is right, start over"

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      const isRejectionPhrase = rejectionPhrases.some((p) => testText.includes(p))
      const isRejectionWord = rejectionWords.some((w) => new RegExp(`\\b${w}\\b`).test(testText))
      const isRejection = isRejectionPhrase || isRejectionWord
      if (!isRejection) throw new Error("should have detected rejection")
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  test("neutral text detection is fast (full scan, no match)", () => {
    const testText = "can you explain the architecture of the data pipeline layer in more detail"

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      const isRejectionPhrase = rejectionPhrases.some((p) => testText.includes(p))
      const isRejectionWord = rejectionWords.some((w) => new RegExp(`\\b${w}\\b`).test(testText))
      const isRejection = isRejectionPhrase || isRejectionWord
      const isApproval = !isRejection && approvalPhrases.some((p) => testText.includes(p))
      const action = isRejection ? "reject" : isApproval ? "approve" : "refine"
      if (action !== "refine") throw new Error("should be refine")
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })

  test("mixed input with varied phrase lengths stays fast", () => {
    const inputs = [
      "looks good",
      "no way",
      "lgtm ship it",
      "please explain more",
      "abort the plan",
      "approved, go ahead",
      "I don't think so",
      "perfect, let's proceed",
      "wrong approach entirely",
      "can you reconsider the database choice",
    ]

    const start = performance.now()
    for (let i = 0; i < 100000; i++) {
      const text = inputs[i % inputs.length]
      const isRejectionPhrase = rejectionPhrases.some((p) => text.includes(p))
      const isRejectionWord = rejectionWords.some((w) => new RegExp(`\\b${w}\\b`).test(text))
      const isRejection = isRejectionPhrase || isRejectionWord
      const isApproval = !isRejection && approvalPhrases.some((p) => text.includes(p))
      const _action = isRejection ? "reject" : isApproval ? "approve" : "refine"
    }
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(200)
  })
})

// ===========================================================================
// Performance: suggestion string output stability
// ===========================================================================

describe("performance: output determinism", () => {
  test("getPostConnectSuggestions returns identical output across runs", () => {
    const ctx = {
      warehouseType: "snowflake",
      schemaIndexed: false,
      dbtDetected: true,
      connectionCount: 2,
      toolsUsedInSession: ["sql_execute"],
    }

    const first = PostConnectSuggestions.getPostConnectSuggestions(ctx)
    for (let i = 0; i < 100; i++) {
      const result = PostConnectSuggestions.getPostConnectSuggestions(ctx)
      expect(result).toBe(first)
    }
  })

  test("getProgressiveSuggestion returns identical output across runs (with reset)", () => {
    const tools = ["sql_execute", "sql_analyze", "schema_inspect", "schema_index"]
    const baseline = tools.map((t) => PostConnectSuggestions.getProgressiveSuggestion(t))

    for (let i = 0; i < 100; i++) {
      PostConnectSuggestions.resetShownSuggestions()
      for (let j = 0; j < tools.length; j++) {
        expect(PostConnectSuggestions.getProgressiveSuggestion(tools[j])).toBe(baseline[j])
      }
    }
  })
})
