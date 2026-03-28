// altimate_change start — tests for proxied() corporate proxy detection
import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { proxied } from "../../src/util/proxied"

describe("proxied(): corporate proxy detection", () => {
  const PROXY_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const v of PROXY_VARS) {
      saved[v] = process.env[v]
      delete process.env[v]
    }
  })

  afterEach(() => {
    for (const v of PROXY_VARS) {
      if (saved[v] !== undefined) process.env[v] = saved[v]
      else delete process.env[v]
    }
  })

  test("returns false when no proxy env vars are set", () => {
    expect(proxied()).toBe(false)
  })

  test("returns true when HTTP_PROXY is set", () => {
    process.env.HTTP_PROXY = "http://proxy.corp.com:8080"
    expect(proxied()).toBe(true)
  })

  test("returns true when HTTPS_PROXY is set", () => {
    process.env.HTTPS_PROXY = "http://proxy.corp.com:8443"
    expect(proxied()).toBe(true)
  })

  test("returns true when lowercase http_proxy is set", () => {
    process.env.http_proxy = "http://proxy.corp.com:8080"
    expect(proxied()).toBe(true)
  })

  test("returns true when lowercase https_proxy is set", () => {
    process.env.https_proxy = "http://proxy.corp.com:8443"
    expect(proxied()).toBe(true)
  })

  test("returns false when env var is set to empty string", () => {
    process.env.HTTP_PROXY = ""
    expect(proxied()).toBe(false)
  })
})
// altimate_change end
