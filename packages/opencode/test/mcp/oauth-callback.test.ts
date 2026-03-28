/**
 * Tests for MCP OAuth callback server — XSS prevention and HTTP behavior.
 *
 * The OAuth callback page renders error messages from external MCP servers.
 * If escapeHtml (module-private) fails to sanitize these strings, a malicious
 * server could inject scripts into the user's browser via error_description.
 *
 * Tests exercise the server at the HTTP level since escapeHtml is not exported.
 */
import { describe, test, expect, afterEach, beforeEach } from "bun:test"

const { McpOAuthCallback } = await import("../../src/mcp/oauth-callback")
const { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_PATH } = await import("../../src/mcp/oauth-provider")

const BASE_URL = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}${OAUTH_CALLBACK_PATH}`

beforeEach(async () => {
  // Ensure clean state — stop any leftover server
  await McpOAuthCallback.stop()
  await McpOAuthCallback.ensureRunning()
})

afterEach(async () => {
  await McpOAuthCallback.stop()
})

// ---------------------------------------------------------------------------
// XSS prevention
// ---------------------------------------------------------------------------

describe("OAuth callback: XSS prevention in error page", () => {
  test("escapes <script> tags in error_description", async () => {
    const xss = "<script>alert(1)</script>"
    const url = `${BASE_URL}?error=access_denied&error_description=${encodeURIComponent(xss)}&state=test-state`
    const res = await fetch(url)
    const body = await res.text()

    // The raw <script> must never appear in the response
    expect(body).not.toContain("<script>")
    expect(body).toContain("&lt;script&gt;")
  })

  test("escapes HTML entities in error_description", async () => {
    const payload = 'foo & bar < baz > "qux"'
    const url = `${BASE_URL}?error=access_denied&error_description=${encodeURIComponent(payload)}&state=test-state`
    const res = await fetch(url)
    const body = await res.text()

    expect(body).toContain("foo &amp; bar")
    expect(body).toContain("&lt; baz &gt;")  // < and > escaped
    expect(body).toContain("&quot;qux&quot;")
  })

  test("escapes img onerror XSS vector", async () => {
    const xss = '<img src=x onerror="alert(1)">'
    const url = `${BASE_URL}?error=access_denied&error_description=${encodeURIComponent(xss)}&state=test-state`
    const res = await fetch(url)
    const body = await res.text()

    expect(body).not.toContain("<img")
    expect(body).toContain("&lt;img")
  })

  test("escapes event handler injection", async () => {
    const xss = '" onmouseover="alert(1)" data-x="'
    const url = `${BASE_URL}?error=access_denied&error_description=${encodeURIComponent(xss)}&state=test-state`
    const res = await fetch(url)
    const body = await res.text()

    // Double quotes must be escaped
    expect(body).toContain("&quot;")
    expect(body).not.toContain('onmouseover="alert')
  })
})

// ---------------------------------------------------------------------------
// HTTP behavior
// ---------------------------------------------------------------------------

describe("OAuth callback: HTTP behavior", () => {
  test("returns 404 for non-callback paths", async () => {
    const res = await fetch(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/not-a-callback`)
    expect(res.status).toBe(404)
  })

  test("returns 400 when state parameter is missing", async () => {
    const url = `${BASE_URL}?error=access_denied&error_description=test`
    const res = await fetch(url)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Missing required state parameter")
  })

  test("returns 400 when code is missing (no error)", async () => {
    const url = `${BASE_URL}?state=some-state`
    const res = await fetch(url)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("No authorization code")
  })

  test("returns HTML content type for error pages", async () => {
    const url = `${BASE_URL}?error=access_denied&error_description=test&state=test-state`
    const res = await fetch(url)
    expect(res.headers.get("content-type")).toContain("text/html")
  })

  test("invalid state returns error about CSRF", async () => {
    // Register no pending auth, so any state is invalid
    const url = `${BASE_URL}?code=test-code&state=unknown-state`
    const res = await fetch(url)
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toContain("Invalid or expired state")
  })
})

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

describe("OAuth callback: server lifecycle", () => {
  test("isRunning returns true after ensureRunning", () => {
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })

  test("isRunning returns false after stop", async () => {
    await McpOAuthCallback.stop()
    expect(McpOAuthCallback.isRunning()).toBe(false)
  })

  test("ensureRunning is idempotent", async () => {
    // Server already running from beforeEach
    await McpOAuthCallback.ensureRunning()
    expect(McpOAuthCallback.isRunning()).toBe(true)
  })
})
