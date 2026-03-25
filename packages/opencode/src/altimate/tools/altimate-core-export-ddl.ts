import z from "zod"
import { Tool } from "../../tool/tool"
import { Dispatcher } from "../native"

export const AltimateCoreExportDdlTool = Tool.define("altimate_core_export_ddl", {
  description:
    "Export a YAML/JSON schema as CREATE TABLE DDL statements. Provide schema_context or schema_path for accurate table/column resolution.",
  parameters: z.object({
    schema_path: z.string().optional().describe("Path to YAML/JSON schema file"),
    schema_context: z.record(z.string(), z.any()).optional().describe("Inline schema definition"),
  }),
  async execute(args, ctx) {
    try {
      const result = await Dispatcher.call("altimate_core.export_ddl", {
        schema_path: args.schema_path ?? "",
        schema_context: args.schema_context,
      })
      const data = (result.data ?? {}) as Record<string, any>
      const error = result.error ?? data.error
      return {
        title: "Export DDL: done",
        metadata: { success: result.success, ...(error && { error }) },
        output: data.ddl ?? JSON.stringify(data, null, 2),
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return { title: "Export DDL: ERROR", metadata: { success: false, error: msg }, output: `Failed: ${msg}` }
    }
  },
})
