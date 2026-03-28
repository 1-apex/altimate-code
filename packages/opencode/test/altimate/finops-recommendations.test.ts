import { describe, test, expect } from "bun:test"
import { SQL_TEMPLATES as AdvisorTemplates } from "../../src/altimate/native/finops/warehouse-advisor"

describe("FinOps: warehouse-advisor generateSizingRecommendations", () => {
  const { generateSizingRecommendations } = AdvisorTemplates

  test("SCALE_UP when avg_queue_load > 1.0", () => {
    const loadData = [
      { warehouse_name: "ANALYTICS_WH", avg_queue_load: 2.5, peak_queue_load: 8.0, avg_concurrency: 5.0, sample_count: 100 },
    ]
    const sizeByWarehouse = new Map([["ANALYTICS_WH", "Medium"]])
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    const scaleUp = recs.find((r: any) => r.type === "SCALE_UP")
    expect(scaleUp).toBeDefined()
    expect(scaleUp!.warehouse).toBe("ANALYTICS_WH")
    expect(scaleUp!.current_size).toBe("Medium")
    expect(scaleUp!.impact).toBe("high")
    expect((scaleUp!.message as string)).toContain("2.5")
  })

  test("BURST_SCALING when peak_queue_load > 5.0 but avg_queue_load <= 1.0", () => {
    const loadData = [
      { warehouse_name: "ETL_WH", avg_queue_load: 0.5, peak_queue_load: 12.0, avg_concurrency: 3.0, sample_count: 50 },
    ]
    const sizeByWarehouse = new Map([["ETL_WH", "Large"]])
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    const burst = recs.find((r: any) => r.type === "BURST_SCALING")
    expect(burst).toBeDefined()
    expect(burst!.warehouse).toBe("ETL_WH")
    expect(burst!.impact).toBe("medium")
  })

  test("SCALE_DOWN when avg_concurrency < 0.1 and avg_queue < 0.01 and size > X-Small", () => {
    const loadData = [
      { warehouse_name: "DEV_WH", avg_queue_load: 0.001, peak_queue_load: 0.01, avg_concurrency: 0.05, sample_count: 200 },
    ]
    const sizeByWarehouse = new Map([["DEV_WH", "Large"]])
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    const scaleDown = recs.find((r: any) => r.type === "SCALE_DOWN")
    expect(scaleDown).toBeDefined()
    expect(scaleDown!.warehouse).toBe("DEV_WH")
    expect(scaleDown!.current_size).toBe("Large")
    expect(scaleDown!.suggested_size).toBe("Medium")
  })

  test("SCALE_DOWN not suggested when already at X-Small", () => {
    const loadData = [
      { warehouse_name: "TINY_WH", avg_queue_load: 0.0, peak_queue_load: 0.0, avg_concurrency: 0.01, sample_count: 10 },
    ]
    const sizeByWarehouse = new Map([["TINY_WH", "X-Small"]])
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    const scaleDown = recs.find((r: any) => r.type === "SCALE_DOWN")
    expect(scaleDown).toBeUndefined()
  })

  test("multiple warehouses can produce multiple different recommendations", () => {
    const loadData = [
      { warehouse_name: "HOT_WH", avg_queue_load: 3.0, peak_queue_load: 10.0, avg_concurrency: 8.0, sample_count: 500 },
      { warehouse_name: "COLD_WH", avg_queue_load: 0.0, peak_queue_load: 0.0, avg_concurrency: 0.02, sample_count: 10 },
    ]
    const sizeByWarehouse = new Map([["HOT_WH", "Medium"], ["COLD_WH", "Large"]])
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    expect(recs.some((r: any) => r.type === "SCALE_UP" && r.warehouse === "HOT_WH")).toBe(true)
    expect(recs.some((r: any) => r.type === "SCALE_DOWN" && r.warehouse === "COLD_WH")).toBe(true)
  })

  test("falls back to 'unknown' when sizeByWarehouse has no entry", () => {
    const loadData = [
      { warehouse_name: "MYSTERY_WH", avg_queue_load: 2.0, peak_queue_load: 3.0, avg_concurrency: 1.0, sample_count: 100 },
    ]
    const sizeByWarehouse = new Map<string, string>()
    const recs = generateSizingRecommendations(loadData, [], sizeByWarehouse)

    const scaleUp = recs.find((r: any) => r.type === "SCALE_UP")
    expect(scaleUp).toBeDefined()
    expect(scaleUp!.current_size).toBe("unknown")
  })
})
