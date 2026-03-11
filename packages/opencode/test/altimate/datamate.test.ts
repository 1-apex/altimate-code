import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import path from "path"
import os from "os"
import fsp from "fs/promises"

import { AltimateApi } from "../../src/altimate/api/client"
import { slugify } from "../../src/altimate/tools/datamate"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpRoot = path.join(os.tmpdir(), "datamate-test-" + process.pid + "-" + Math.random().toString(36).slice(2))

// ---------------------------------------------------------------------------
// buildMcpConfig
// ---------------------------------------------------------------------------

describe("buildMcpConfig", () => {
  const creds = {
    altimateUrl: "https://api.getaltimate.com",
    altimateInstanceName: "megatenant",
    altimateApiKey: "test-api-key-123",
  }

  test("returns correct shape with 4 headers", () => {
    const config = AltimateApi.buildMcpConfig(creds, "42")
    expect(config.type).toBe("remote")
    expect(config.headers).toBeDefined()
    expect(Object.keys(config.headers)).toHaveLength(4)
    expect(config.headers["Authorization"]).toBe("Bearer test-api-key-123")
    expect(config.headers["x-datamate-id"]).toBe("42")
    expect(config.headers["x-tenant"]).toBe("megatenant")
    expect(config.headers["x-altimate-url"]).toBe("https://api.getaltimate.com")
  })

  test("uses default MCP URL when mcpServerUrl not set", () => {
    const config = AltimateApi.buildMcpConfig(creds, "1")
    expect(config.url).toBe("https://mcpserver.getaltimate.com/sse")
  })

  test("uses override MCP URL when mcpServerUrl set", () => {
    const credsWithUrl = { ...creds, mcpServerUrl: "https://custom.example.com/sse" }
    const config = AltimateApi.buildMcpConfig(credsWithUrl, "1")
    expect(config.url).toBe("https://custom.example.com/sse")
  })

  test("sets oauth to false", () => {
    const config = AltimateApi.buildMcpConfig(creds, "1")
    expect(config.oauth).toBe(false)
  })

  test("coerces datamate ID to string", () => {
    const config = AltimateApi.buildMcpConfig(creds, "123")
    expect(config.headers["x-datamate-id"]).toBe("123")
    expect(typeof config.headers["x-datamate-id"]).toBe("string")
  })
})

// ---------------------------------------------------------------------------
// credentialsPath
// ---------------------------------------------------------------------------

describe("credentialsPath", () => {
  test("returns path under home directory", () => {
    const p = AltimateApi.credentialsPath()
    expect(p).toContain(".altimate")
    expect(p).toContain("altimate.json")
    expect(p.endsWith(path.join(".altimate", "altimate.json"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getCredentials
// ---------------------------------------------------------------------------

describe("getCredentials", () => {
  const testHome = path.join(tmpRoot, "creds-test")

  beforeEach(async () => {
    process.env.OPENCODE_TEST_HOME = testHome
    await fsp.mkdir(testHome, { recursive: true })
  })

  afterEach(async () => {
    delete process.env.OPENCODE_TEST_HOME
    await fsp.rm(testHome, { recursive: true, force: true }).catch(() => {})
  })

  test("throws when file missing", async () => {
    await expect(AltimateApi.getCredentials()).rejects.toThrow("credentials not found")
  })

  test("parses valid file", async () => {
    const altDir = path.join(testHome, ".altimate")
    await fsp.mkdir(altDir, { recursive: true })
    await fsp.writeFile(
      path.join(altDir, "altimate.json"),
      JSON.stringify({
        altimateUrl: "https://api.test.com",
        altimateInstanceName: "testco",
        altimateApiKey: "key123",
      }),
    )
    const creds = await AltimateApi.getCredentials()
    expect(creds.altimateUrl).toBe("https://api.test.com")
    expect(creds.altimateInstanceName).toBe("testco")
    expect(creds.altimateApiKey).toBe("key123")
  })

  test("throws on malformed JSON", async () => {
    const altDir = path.join(testHome, ".altimate")
    await fsp.mkdir(altDir, { recursive: true })
    await fsp.writeFile(path.join(altDir, "altimate.json"), "not json")
    await expect(AltimateApi.getCredentials()).rejects.toThrow()
  })

  test("throws on missing required fields", async () => {
    const altDir = path.join(testHome, ".altimate")
    await fsp.mkdir(altDir, { recursive: true })
    await fsp.writeFile(
      path.join(altDir, "altimate.json"),
      JSON.stringify({ altimateUrl: "https://api.test.com" }),
    )
    await expect(AltimateApi.getCredentials()).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

describe("slugify", () => {
  test("converts spaces and special chars to hyphens", () => {
    expect(slugify("My SQL Expert!")).toBe("my-sql-expert")
  })

  test("lowercases", () => {
    expect(slugify("TestName")).toBe("testname")
  })

  test("strips leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello")
  })

  test("collapses multiple special chars", () => {
    expect(slugify("a   b...c")).toBe("a-b-c")
  })
})

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {})
})
