/**
 * Tests for `altimate-code stats` display formatting.
 *
 * displayStats() is the primary user-facing output for the stats command.
 * formatNumber (module-private) converts token counts to human-readable
 * format (e.g., 1500 → "1.5K"). These tests verify formatting via the
 * exported displayStats function to catch regressions in CLI output.
 */
import { describe, test, expect } from "bun:test"
import { displayStats } from "../../src/cli/cmd/stats"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture console.log output from a synchronous function. */
function captureOutput(fn: () => void): string {
  const lines: string[] = []
  const origLog = console.log
  // displayStats also uses process.stdout.write for ANSI cursor movement
  // in the model-usage section — we skip that branch by not passing modelLimit.
  console.log = (...args: unknown[]) => lines.push(args.join(" "))
  try {
    fn()
  } finally {
    console.log = origLog
  }
  return lines.join("\n")
}

/** Minimal valid SessionStats — all zeroes. */
function emptyStats() {
  return {
    totalSessions: 0,
    totalMessages: 0,
    totalCost: 0,
    totalTokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    toolUsage: {} as Record<string, number>,
    modelUsage: {} as Record<string, { messages: number; tokens: { input: number; output: number; cache: { read: number; write: number } }; cost: number }>,
    dateRange: { earliest: Date.now(), latest: Date.now() },
    days: 1,
    costPerDay: 0,
    tokensPerSession: 0,
    medianTokensPerSession: 0,
  }
}

// ---------------------------------------------------------------------------
// formatNumber via displayStats
// ---------------------------------------------------------------------------

describe("stats: formatNumber rendering", () => {
  test("values under 1000 display as plain integer", () => {
    const stats = emptyStats()
    stats.totalTokens.input = 999
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("999")
    // Should not be formatted with K or M suffix
    expect(out).not.toMatch(/999.*K/)
  })

  test("exactly 1000 displays as 1.0K", () => {
    const stats = emptyStats()
    stats.totalTokens.input = 1000
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("1.0K")
  })

  test("1500 displays as 1.5K", () => {
    const stats = emptyStats()
    stats.totalTokens.input = 1500
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("1.5K")
  })

  test("exactly 1000000 displays as 1.0M", () => {
    const stats = emptyStats()
    stats.totalTokens.input = 1_000_000
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("1.0M")
  })

  test("2500000 displays as 2.5M", () => {
    const stats = emptyStats()
    stats.totalTokens.input = 2_500_000
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("2.5M")
  })

  test("zero displays as 0", () => {
    const stats = emptyStats()
    const out = captureOutput(() => displayStats(stats))
    // Input line should show 0, not "0K" or empty
    expect(out).toMatch(/Input\s+0\s/)
  })
})

// ---------------------------------------------------------------------------
// displayStats: cost and NaN safety
// ---------------------------------------------------------------------------

describe("stats: cost display safety", () => {
  test("zero cost renders as $0.00, never NaN", () => {
    const stats = emptyStats()
    const out = captureOutput(() => displayStats(stats))
    expect(out).not.toContain("NaN")
    expect(out).toContain("$0.00")
  })

  test("fractional cost renders with two decimal places", () => {
    const stats = emptyStats()
    stats.totalCost = 1.234
    stats.costPerDay = 0.617
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("$1.23")
    expect(out).toContain("$0.62")
  })
})

// ---------------------------------------------------------------------------
// displayStats: tool usage rendering
// ---------------------------------------------------------------------------

describe("stats: tool usage display", () => {
  test("tool usage shows bar chart with percentages", () => {
    const stats = emptyStats()
    stats.toolUsage = { read: 50, write: 30, bash: 20 }
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("TOOL USAGE")
    expect(out).toContain("read")
    expect(out).toContain("write")
    expect(out).toContain("bash")
    // Percentages should be present
    expect(out).toContain("%")
  })

  test("tool limit restricts number of tools shown", () => {
    const stats = emptyStats()
    stats.toolUsage = { read: 50, write: 30, bash: 20, edit: 10, glob: 5 }
    const out = captureOutput(() => displayStats(stats, 2))
    // Only top 2 tools should appear (read and write by count)
    expect(out).toContain("read")
    expect(out).toContain("write")
    expect(out).not.toContain("glob")
  })

  test("empty tool usage omits TOOL USAGE section", () => {
    const stats = emptyStats()
    stats.toolUsage = {}
    const out = captureOutput(() => displayStats(stats))
    expect(out).not.toContain("TOOL USAGE")
  })

  test("long tool names are truncated", () => {
    const stats = emptyStats()
    stats.toolUsage = { "a_very_long_tool_name_that_exceeds_limit": 10 }
    const out = captureOutput(() => displayStats(stats))
    // Tool name should be truncated to fit the column
    expect(out).toContain("..")
  })
})

// ---------------------------------------------------------------------------
// displayStats: overview section
// ---------------------------------------------------------------------------

describe("stats: overview section", () => {
  test("renders session and message counts", () => {
    const stats = emptyStats()
    stats.totalSessions = 42
    stats.totalMessages = 1337
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("OVERVIEW")
    expect(out).toContain("42")
    expect(out).toContain("1,337")
  })

  test("renders box-drawing borders", () => {
    const stats = emptyStats()
    const out = captureOutput(() => displayStats(stats))
    expect(out).toContain("┌")
    expect(out).toContain("┘")
    expect(out).toContain("│")
  })
})
