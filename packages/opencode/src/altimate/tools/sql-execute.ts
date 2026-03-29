import z from "zod"
import { Tool } from "../../tool/tool"
import { Dispatcher } from "../native"
import type { SqlExecuteResult } from "../native/types"
// altimate_change start - SQL write access control + fingerprinting
import { classifyAndCheck, computeSqlFingerprint } from "./sql-classify"
import { Telemetry } from "../telemetry"
// altimate_change end
// altimate_change start — progressive disclosure suggestions
import { PostConnectSuggestions } from "./post-connect-suggestions"
// altimate_change end

export const SqlExecuteTool = Tool.define("sql_execute", {
  description: "Execute SQL against a connected data warehouse. Returns results as a formatted table.",
  parameters: z.object({
    query: z.string().describe("SQL query to execute"),
    warehouse: z.string().optional().describe("Warehouse connection name"),
    limit: z.number().optional().default(100).describe("Max rows to return"),
  }),
  async execute(args, ctx) {
    // altimate_change start - SQL write access control
    // Permission checks OUTSIDE try/catch so denial errors propagate to the framework
    const { queryType, blocked } = classifyAndCheck(args.query)
    if (blocked) {
      throw new Error("DROP DATABASE, DROP SCHEMA, and TRUNCATE are blocked for safety. This cannot be overridden.")
    }
    if (queryType === "write") {
      await ctx.ask({
        permission: "sql_execute_write",
        patterns: [args.query.slice(0, 200)],
        always: ["*"],
        metadata: { queryType },
      })
    }
    // altimate_change end

    try {
      const result = await Dispatcher.call("sql.execute", {
        sql: args.query,
        warehouse: args.warehouse,
        limit: args.limit,
      })

      let output = formatResult(result)
      // altimate_change start — emit SQL structure fingerprint telemetry
      try {
        const fp = computeSqlFingerprint(args.query)
        if (fp) {
          Telemetry.track({
            type: "sql_fingerprint",
            timestamp: Date.now(),
            session_id: ctx.sessionID,
            statement_types: JSON.stringify(fp.statement_types),
            categories: JSON.stringify(fp.categories),
            table_count: fp.table_count,
            function_count: fp.function_count,
            has_subqueries: fp.has_subqueries,
            has_aggregation: fp.has_aggregation,
            has_window_functions: fp.has_window_functions,
            node_count: fp.node_count,
          })
        }
      } catch {
        // Fingerprinting must never break query execution
      }
      // altimate_change end
      // altimate_change start — progressive disclosure suggestions
      const suggestion = PostConnectSuggestions.getProgressiveSuggestion("sql_execute")
      if (suggestion) {
        output += "\n\n" + suggestion
        PostConnectSuggestions.trackSuggestions({
          suggestionType: "progressive_disclosure",
          suggestionsShown: ["sql_analyze"],
          warehouseType: args.warehouse ?? "default",
        })
      }
      // altimate_change end
      return {
        title: `SQL: ${args.query.slice(0, 60)}${args.query.length > 60 ? "..." : ""}`,
        metadata: { rowCount: result.row_count, truncated: result.truncated },
        output,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        title: "SQL: ERROR",
        metadata: { rowCount: 0, truncated: false, error: msg },
        output: `Failed to execute SQL: ${msg}\n\nEnsure the dispatcher is running and a warehouse connection is configured.`,
      }
    }
  },
})

function formatResult(result: SqlExecuteResult): string {
  if (result.row_count === 0) return "(0 rows)"

  const header = result.columns.join(" | ")
  const separator = result.columns.map((c) => "-".repeat(Math.max(c.length, 4))).join("-+-")
  const rows = result.rows.map((r) => r.map((v) => (v === null ? "NULL" : String(v))).join(" | ")).join("\n")

  let output = `${header}\n${separator}\n${rows}\n\n(${result.row_count} rows)`
  if (result.truncated) output += " [truncated]"
  return output
}
