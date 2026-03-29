import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test"
import { Telemetry } from "../../src/telemetry"
import { PostConnectSuggestions } from "../../src/altimate/tools/post-connect-suggestions"

// Capture tracked events via spyOn instead of mock.module to avoid
// Bun's process-global mock.module leaking into other test files.
const trackedEvents: any[] = []

beforeEach(() => {
  trackedEvents.length = 0
  PostConnectSuggestions.resetShownSuggestions()
  spyOn(Telemetry, "track").mockImplementation((event: any) => {
    trackedEvents.push(event)
  })
  spyOn(Telemetry, "getContext").mockReturnValue({
    sessionId: "test-session-123",
    projectId: "",
  } as any)
})

afterEach(() => {
  mock.restore()
})

describe("PostConnectSuggestions.getPostConnectSuggestions", () => {
  test("includes schema_index when schema is not indexed", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "snowflake",
      schemaIndexed: false,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("schema_index")
    expect(result).toContain("Index your schema")
  })

  test("does not include schema_index when schema is already indexed", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "snowflake",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).not.toContain("schema_index")
    expect(result).not.toContain("Index your schema")
  })

  test("includes dbt skill suggestions when dbt is detected", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "postgres",
      schemaIndexed: false,
      dbtDetected: true,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("/dbt-develop")
    expect(result).toContain("/dbt-troubleshoot")
    expect(result).toContain("dbt project detected")
  })

  test("does not include dbt suggestions when dbt is not detected", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "postgres",
      schemaIndexed: false,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).not.toContain("/dbt-develop")
    expect(result).not.toContain("dbt project detected")
  })

  test("includes data_diff when multiple connections exist", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "bigquery",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 3,
      toolsUsedInSession: [],
    })
    expect(result).toContain("data_diff")
    expect(result).toContain("Compare data across warehouses")
  })

  test("does not include data_diff for single connection", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "bigquery",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).not.toContain("data_diff")
  })

  test("always includes sql_execute and sql_analyze", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "snowflake",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("sql_execute")
    expect(result).toContain("sql_analyze")
  })

  test("always includes lineage_check and schema_detect_pii", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "snowflake",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("lineage_check")
    expect(result).toContain("schema_detect_pii")
  })

  test("includes warehouse type in header", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "databricks",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("databricks")
    expect(result).toContain("Available capabilities for your databricks warehouse")
  })

  test("formats suggestions as numbered list", () => {
    const result = PostConnectSuggestions.getPostConnectSuggestions({
      warehouseType: "snowflake",
      schemaIndexed: true,
      dbtDetected: false,
      connectionCount: 1,
      toolsUsedInSession: [],
    })
    expect(result).toContain("1.")
    expect(result).toContain("2.")
  })
})

describe("PostConnectSuggestions.getProgressiveSuggestion", () => {
  test("after sql_execute suggests sql_analyze", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("sql_execute")
    expect(result).not.toBeNull()
    expect(result).toContain("sql_analyze")
  })

  test("after sql_analyze suggests schema_inspect", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("sql_analyze")
    expect(result).not.toBeNull()
    expect(result).toContain("schema_inspect")
  })

  test("after schema_inspect suggests lineage_check", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("schema_inspect")
    expect(result).not.toBeNull()
    expect(result).toContain("lineage_check")
  })

  test("after schema_index suggests sql_analyze, schema_inspect, lineage_check", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("schema_index")
    expect(result).not.toBeNull()
    expect(result).toContain("sql_analyze")
    expect(result).toContain("schema_inspect")
    expect(result).toContain("lineage_check")
  })

  test("warehouse_add returns null (handled by post-connect suggestions)", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("warehouse_add")
    expect(result).toBeNull()
  })

  test("unknown tool returns null", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("some_unknown_tool")
    expect(result).toBeNull()
  })

  test("empty string returns null", () => {
    const result = PostConnectSuggestions.getProgressiveSuggestion("")
    expect(result).toBeNull()
  })
})

describe("PostConnectSuggestions.trackSuggestions", () => {
  test("emits feature_suggestion telemetry event", () => {
    PostConnectSuggestions.trackSuggestions({
      suggestionType: "post_warehouse_connect",
      suggestionsShown: ["schema_index", "sql_analyze"],
      warehouseType: "snowflake",
    })

    expect(trackedEvents.length).toBe(1)
    expect(trackedEvents[0].type).toBe("feature_suggestion")
    expect(trackedEvents[0].suggestion_type).toBe("post_warehouse_connect")
    expect(trackedEvents[0].suggestions_shown).toEqual(["schema_index", "sql_analyze"])
    expect(trackedEvents[0].warehouse_type).toBe("snowflake")
    expect(trackedEvents[0].session_id).toBe("test-session-123")
    expect(trackedEvents[0].timestamp).toBeGreaterThan(0)
  })

  test("emits progressive_disclosure telemetry event", () => {
    PostConnectSuggestions.trackSuggestions({
      suggestionType: "progressive_disclosure",
      suggestionsShown: ["sql_analyze"],
    })

    expect(trackedEvents.length).toBe(1)
    expect(trackedEvents[0].type).toBe("feature_suggestion")
    expect(trackedEvents[0].suggestion_type).toBe("progressive_disclosure")
    expect(trackedEvents[0].warehouse_type).toBe("unknown")
  })

  test("emits dbt_detected telemetry event", () => {
    PostConnectSuggestions.trackSuggestions({
      suggestionType: "dbt_detected",
      suggestionsShown: ["dbt_develop", "dbt_troubleshoot", "dbt_analyze"],
    })

    expect(trackedEvents.length).toBe(1)
    expect(trackedEvents[0].suggestion_type).toBe("dbt_detected")
    expect(trackedEvents[0].suggestions_shown).toEqual([
      "dbt_develop",
      "dbt_troubleshoot",
      "dbt_analyze",
    ])
  })
})
