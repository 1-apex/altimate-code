import { describe, test, expect } from "bun:test"
import { containerToConfig } from "../../src/altimate/native/connections/docker-discovery"
import type { DockerContainer } from "../../src/altimate/native/types"

describe("containerToConfig: full container with all fields", () => {
  test("converts a complete DockerContainer to ConnectionConfig", () => {
    const container: DockerContainer = {
      container_id: "abc123def456",
      name: "my-postgres",
      image: "postgres:15-alpine",
      db_type: "postgres",
      host: "127.0.0.1",
      port: 5433,
      user: "myuser",
      password: "secret",
      database: "mydb",
      status: "running",
    }

    const config = containerToConfig(container)

    expect(config).toEqual({
      type: "postgres",
      host: "127.0.0.1",
      port: 5433,
      user: "myuser",
      password: "secret",
      database: "mydb",
    })
  })

  test("omits optional fields when not present on container", () => {
    const container: DockerContainer = {
      container_id: "abc123",
      name: "bare-mysql",
      image: "mysql:8",
      db_type: "mysql",
      host: "127.0.0.1",
      port: 3306,
      status: "running",
    }

    const config = containerToConfig(container)

    // Should only have type, host, port — no user, password, database
    expect(Object.keys(config).sort()).toEqual(["host", "port", "type"])
    expect(config.type).toBe("mysql")
    expect(config.host).toBe("127.0.0.1")
    expect(config.port).toBe(3306)
  })

  test("preserves db_type as config.type for all supported databases", () => {
    const dbTypes = ["postgres", "mysql", "sqlserver", "oracle", "duckdb", "sqlite", "mongodb"]

    for (const dbType of dbTypes) {
      const container: DockerContainer = {
        container_id: "x",
        name: `test-${dbType}`,
        image: `${dbType}:latest`,
        db_type: dbType,
        host: "127.0.0.1",
        port: 5432,
        status: "running",
      }
      const config = containerToConfig(container)
      expect(config.type).toBe(dbType)
    }
  })

  test("includes user but not password when only user is set", () => {
    const container: DockerContainer = {
      container_id: "x",
      name: "pg-no-pass",
      image: "postgres:15",
      db_type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      user: "postgres",
      status: "running",
    }

    const config = containerToConfig(container)

    expect(config.user).toBe("postgres")
    expect(config.password).toBeUndefined()
    expect(Object.keys(config).sort()).toEqual(["host", "port", "type", "user"])
  })

  test("includes database but not user/password when only database is set", () => {
    const container: DockerContainer = {
      container_id: "x",
      name: "pg-db-only",
      image: "postgres:15",
      db_type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      database: "analytics",
      status: "running",
    }

    const config = containerToConfig(container)

    expect(config.database).toBe("analytics")
    expect(config.user).toBeUndefined()
    expect(config.password).toBeUndefined()
  })

  test("does not include container_id, name, image, or status in config", () => {
    const container: DockerContainer = {
      container_id: "abc123def456",
      name: "my-container",
      image: "postgres:15",
      db_type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      user: "pg",
      password: "pass",
      database: "db",
      status: "running",
    }

    const config = containerToConfig(container)

    // These Docker-specific fields should NOT leak into the ConnectionConfig
    expect((config as any).container_id).toBeUndefined()
    expect((config as any).name).toBeUndefined()
    expect((config as any).image).toBeUndefined()
    expect((config as any).status).toBeUndefined()
    expect((config as any).db_type).toBeUndefined()
  })
})
