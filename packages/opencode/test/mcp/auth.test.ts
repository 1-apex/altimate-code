/**
 * Tests for McpAuth (src/mcp/auth.ts) — credential persistence, URL validation,
 * and token expiry logic.
 *
 * These functions are the security gate for MCP OAuth: getForUrl() prevents
 * credentials from being sent to the wrong server when a user reconfigures
 * their MCP server URL, and isTokenExpired() controls token refresh decisions.
 *
 * Also tests McpOAuthProvider.clientInformation() expiry handling from
 * src/mcp/oauth-provider.ts.
 */

import { describe, test, expect, afterEach } from "bun:test"
import { tmpdir } from "../fixture/fixture"

const { McpAuth } = await import("../../src/mcp/auth")
const { McpOAuthProvider } = await import("../../src/mcp/oauth-provider")
const { Instance } = await import("../../src/project/instance")

// ---------------------------------------------------------------------------
// McpAuth.getForUrl — URL validation for credential safety
// ---------------------------------------------------------------------------

describe("McpAuth.getForUrl", () => {
  test("returns undefined when no entry exists", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await McpAuth.getForUrl("nonexistent-server", "https://example.com/mcp")
        expect(result).toBeUndefined()
      },
    })
  })

  test("returns undefined when entry has no serverUrl (old version migration)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Write an entry without serverUrl, simulating data from an older version
        await McpAuth.set("legacy-server", {
          tokens: { accessToken: "old-token" },
        })

        const result = await McpAuth.getForUrl("legacy-server", "https://example.com/mcp")
        expect(result).toBeUndefined()
      },
    })
  })

  test("returns undefined when URL has changed (credential safety)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Store credentials for server A
        await McpAuth.set(
          "my-mcp",
          {
            tokens: { accessToken: "token-for-server-a" },
            serverUrl: "https://server-a.example.com/mcp",
          },
          "https://server-a.example.com/mcp",
        )

        // Try to get credentials for server B — must return undefined
        const result = await McpAuth.getForUrl("my-mcp", "https://server-b.example.com/mcp")
        expect(result).toBeUndefined()
      },
    })
  })

  test("returns the entry when URL matches exactly", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const serverUrl = "https://my-server.example.com/mcp"
        await McpAuth.set(
          "my-mcp",
          {
            tokens: { accessToken: "valid-token", refreshToken: "refresh" },
            serverUrl,
          },
          serverUrl,
        )

        const result = await McpAuth.getForUrl("my-mcp", serverUrl)
        expect(result).toBeDefined()
        expect(result!.tokens!.accessToken).toBe("valid-token")
        expect(result!.serverUrl).toBe(serverUrl)
      },
    })
  })

  test("CRUD lifecycle: set → getForUrl → updateTokens → getForUrl", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const name = "lifecycle-test"
        const url = "https://lifecycle.example.com/mcp"

        // Set initial tokens
        await McpAuth.updateTokens(name, { accessToken: "first-token" }, url)

        // Verify retrieval
        const entry1 = await McpAuth.getForUrl(name, url)
        expect(entry1).toBeDefined()
        expect(entry1!.tokens!.accessToken).toBe("first-token")

        // Update tokens (same URL)
        await McpAuth.updateTokens(name, { accessToken: "second-token" }, url)
        const entry2 = await McpAuth.getForUrl(name, url)
        expect(entry2!.tokens!.accessToken).toBe("second-token")

        // Different URL should not return the entry
        const entry3 = await McpAuth.getForUrl(name, "https://different.example.com/mcp")
        expect(entry3).toBeUndefined()
      },
    })
  })
})

// ---------------------------------------------------------------------------
// McpAuth.isTokenExpired — token expiry checking
// ---------------------------------------------------------------------------

describe("McpAuth.isTokenExpired", () => {
  const originalDateNow = Date.now

  afterEach(() => {
    Date.now = originalDateNow
  })

  test("returns null when no tokens exist", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await McpAuth.isTokenExpired("no-such-server")
        expect(result).toBeNull()
      },
    })
  })

  test("returns false when tokens have no expiry (never expires)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await McpAuth.updateTokens("no-expiry", { accessToken: "forever-token" })
        const result = await McpAuth.isTokenExpired("no-expiry")
        expect(result).toBe(false)
      },
    })
  })

  test("returns false when token expiry is in the future", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // expiresAt is in Unix seconds; set to 1 hour from now
        const futureExpiry = Date.now() / 1000 + 3600
        await McpAuth.updateTokens("valid-token", {
          accessToken: "not-expired",
          expiresAt: futureExpiry,
        })
        const result = await McpAuth.isTokenExpired("valid-token")
        expect(result).toBe(false)
      },
    })
  })

  test("returns true when token has expired", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // expiresAt is in Unix seconds; set to 1 hour ago
        const pastExpiry = Date.now() / 1000 - 3600
        await McpAuth.updateTokens("expired-token", {
          accessToken: "old-token",
          expiresAt: pastExpiry,
        })
        const result = await McpAuth.isTokenExpired("expired-token")
        expect(result).toBe(true)
      },
    })
  })
})

// ---------------------------------------------------------------------------
// McpOAuthProvider.clientInformation() — client secret expiry detection
// ---------------------------------------------------------------------------

describe("McpOAuthProvider.clientInformation", () => {
  const originalDateNow = Date.now

  afterEach(() => {
    Date.now = originalDateNow
  })

  test("returns config-based client info when clientId is set", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const provider = new McpOAuthProvider(
          "config-client",
          "https://example.com/mcp",
          { clientId: "my-client-id", clientSecret: "my-secret" },
          { onRedirect: async () => {} },
        )

        const info = await provider.clientInformation()
        expect(info).toBeDefined()
        expect(info!.client_id).toBe("my-client-id")
        expect(info!.client_secret).toBe("my-secret")
      },
    })
  })

  test("returns stored client info when not expired", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const serverUrl = "https://example.com/mcp"

        // Store client info with a future expiry, using the same serverUrl
        await McpAuth.updateClientInfo(
          "stored-client",
          {
            clientId: "dynamic-client-id",
            clientSecret: "dynamic-secret",
            clientSecretExpiresAt: Date.now() / 1000 + 86400, // expires in 24h
          },
          serverUrl,
        )

        const provider = new McpOAuthProvider(
          "stored-client",
          serverUrl,
          {}, // no config clientId — forces lookup from store
          { onRedirect: async () => {} },
        )

        const info = await provider.clientInformation()
        expect(info).toBeDefined()
        expect(info!.client_id).toBe("dynamic-client-id")
        expect(info!.client_secret).toBe("dynamic-secret")
      },
    })
  })

  test("returns undefined when stored client secret has expired (triggers re-registration)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const serverUrl = "https://example.com/mcp"

        // Store client info with an expiry in the past, using the same serverUrl
        await McpAuth.updateClientInfo(
          "expired-client",
          {
            clientId: "old-client-id",
            clientSecret: "old-secret",
            clientSecretExpiresAt: Date.now() / 1000 - 3600, // expired 1 hour ago
          },
          serverUrl,
        )

        const provider = new McpOAuthProvider(
          "expired-client",
          serverUrl,
          {}, // no config clientId
          { onRedirect: async () => {} },
        )

        // Must return undefined so the SDK triggers dynamic registration
        const info = await provider.clientInformation()
        expect(info).toBeUndefined()
      },
    })
  })

  test("returns undefined when no stored credentials and no config (dynamic registration)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const provider = new McpOAuthProvider(
          "brand-new-server",
          "https://brand-new.example.com/mcp",
          {}, // no config
          { onRedirect: async () => {} },
        )

        const info = await provider.clientInformation()
        expect(info).toBeUndefined()
      },
    })
  })
})
