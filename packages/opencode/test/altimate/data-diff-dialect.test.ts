/**
 * Tests for warehouse-type-to-dialect mapping in the data-diff orchestrator.
 *
 * The Rust engine's SqlDialect serde deserialization only accepts exact lowercase
 * variant names (e.g., "tsql", not "sqlserver"). This mapping bridges the gap
 * between warehouse config types and Rust dialect names.
 */
import { describe, test, expect } from "bun:test"

import { warehouseTypeToDialect } from "../../src/altimate/native/connections/data-diff"

describe("warehouseTypeToDialect", () => {
  // --- Remapped types ---

  test("maps sqlserver to tsql", () => {
    expect(warehouseTypeToDialect("sqlserver")).toBe("tsql")
  })

  test("maps mssql to tsql", () => {
    expect(warehouseTypeToDialect("mssql")).toBe("tsql")
  })

  test("maps fabric to fabric", () => {
    expect(warehouseTypeToDialect("fabric")).toBe("fabric")
  })

  test("maps postgresql to postgres", () => {
    expect(warehouseTypeToDialect("postgresql")).toBe("postgres")
  })

  test("maps mariadb to mysql", () => {
    expect(warehouseTypeToDialect("mariadb")).toBe("mysql")
  })

  // --- Passthrough types (already match Rust names) ---

  test("passes through postgres unchanged", () => {
    expect(warehouseTypeToDialect("postgres")).toBe("postgres")
  })

  test("passes through snowflake unchanged", () => {
    expect(warehouseTypeToDialect("snowflake")).toBe("snowflake")
  })

  test("passes through generic unchanged", () => {
    expect(warehouseTypeToDialect("generic")).toBe("generic")
  })

  // --- Case insensitivity ---

  test("handles uppercase input", () => {
    expect(warehouseTypeToDialect("SQLSERVER")).toBe("tsql")
    expect(warehouseTypeToDialect("PostgreSQL")).toBe("postgres")
  })
})
