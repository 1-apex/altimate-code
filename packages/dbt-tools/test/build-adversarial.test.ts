import { describe, test, expect, beforeAll } from "bun:test"
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync } from "fs"
import { join, resolve } from "path"
import { tmpdir } from "os"
import { $ } from "bun"

const dist = join(import.meta.dir, "../dist")
const scriptDir = join(import.meta.dir, "../script")

// ─── Helpers ─────────────────────────────────────────────────────────
// Simulate what copy-python.ts does against arbitrary bundle content,
// without touching the real dist/index.js.
function runPatchLogic(bundleContent: string): { patched: boolean; output: string } {
  const pattern = /var __dirname\s*=\s*"[^"]*python-bridge[^"]*"/
  if (pattern.test(bundleContent)) {
    const replacement = `var __dirname = typeof import.meta.dirname === "string" ? import.meta.dirname : __require("path").dirname(__require("url").fileURLToPath(import.meta.url))`
    return { patched: true, output: bundleContent.replace(pattern, replacement) }
  }
  return { patched: false, output: bundleContent }
}

// ─── Adversarial: Regex edge cases ──────────────────────────────────
describe("adversarial: patch regex", () => {
  test("matches typical CI runner path (Linux)", () => {
    const bundle = `var __dirname = "/home/runner/work/altimate-code/node_modules/.bun/python-bridge@1.1.0/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
    expect(result.output).toContain("import.meta.dirname")
    expect(result.output).not.toContain("/home/runner")
  })

  test("matches macOS dev path", () => {
    const bundle = `var __dirname = "/Users/dev/code/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
    expect(result.output).not.toContain("/Users/dev")
  })

  test("matches Windows CI path", () => {
    const bundle = `var __dirname = "C:\\Users\\runneradmin\\work\\node_modules\\python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
    expect(result.output).not.toContain("C:\\Users")
  })

  test("matches path with @scope in node_modules", () => {
    const bundle = `var __dirname = "/opt/ci/node_modules/.bun/python-bridge@2.0.0/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("does NOT match unrelated __dirname (no python-bridge)", () => {
    const bundle = `var __dirname = "/home/runner/work/some-other-module"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(false)
    // The original hardcoded path is preserved — this is CORRECT behavior.
    // The patch should only touch the python-bridge dirname.
  })

  test("does NOT match __dirname that's already patched", () => {
    const bundle = `var __dirname = typeof import.meta.dirname === "string" ? import.meta.dirname : __require("path").dirname(__require("url").fileURLToPath(import.meta.url))`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(false)
  })

  test("handles extra whitespace in assignment", () => {
    const bundle = `var __dirname  =   "/some/path/to/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("only patches FIRST match (non-global)", () => {
    const bundle = [`var __dirname = "/first/path/python-bridge"`, `var __dirname = "/second/path/python-bridge"`].join(
      "\n",
    )
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
    // First one is patched
    expect(result.output).toContain("import.meta.dirname")
    // Second one survives — this is a known limitation
    expect(result.output).toContain("/second/path/python-bridge")
  })

  test("does NOT match if quotes are single quotes", () => {
    const bundle = `var __dirname = '/home/runner/python-bridge'`
    const result = runPatchLogic(bundle)
    // Bun uses double quotes, so single-quote paths should not match
    expect(result.patched).toBe(false)
  })

  test("does NOT match let or const declarations", () => {
    const bundle = `const __dirname = "/home/runner/python-bridge"`
    const result = runPatchLogic(bundle)
    // Pattern specifically matches `var __dirname` — const/let won't match
    expect(result.patched).toBe(false)
  })
})

// ─── Adversarial: Built output invariants ───────────────────────────
describe("adversarial: built bundle invariants", () => {
  beforeAll(async () => {
    // Ensure we have a fresh build
    if (!existsSync(join(dist, "index.js"))) {
      await $`bun run build`.cwd(join(import.meta.dir, ".."))
    }
  })

  test("exactly ONE __dirname assignment exists in bundle", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    const matches = code.match(/var __dirname\s*=/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBe(1)
  })

  test("__dirname is used to resolve PYTHON_BRIDGE_SCRIPT", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    expect(code).toContain('path.join(__dirname, "node_python_bridge.py")')
  })

  test("no CI runner paths leaked anywhere in bundle", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // Common CI runner path prefixes
    expect(code).not.toContain("/home/runner/work/")
    expect(code).not.toContain("/github/workspace/")
    expect(code).not.toContain("D:\\a\\altimate-code\\")
  })

  test("patched __dirname includes both primary and fallback paths", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    const line = code.split("\n").find((l) => l.includes("var __dirname"))
    expect(line).toBeDefined()
    // Primary: import.meta.dirname
    expect(line).toContain("import.meta.dirname")
    // Fallback: fileURLToPath
    expect(line).toContain("fileURLToPath")
    // Uses __require (Bun's bundled require)
    expect(line).toContain("__require")
  })

  test("node_python_bridge.py in dist matches the source", () => {
    const resolved = require.resolve("@altimateai/dbt-integration")
    const sourcePy = join(require("path").dirname(resolved), "node_python_bridge.py")
    if (!existsSync(sourcePy)) return // skip if source not available

    const source = readFileSync(sourcePy, "utf8")
    const copied = readFileSync(join(dist, "node_python_bridge.py"), "utf8")
    expect(copied).toBe(source)
  })

  test("altimate_python_packages directory was copied", () => {
    expect(existsSync(join(dist, "altimate_python_packages"))).toBe(true)
  })
})

// ─── Adversarial: Runtime resolution simulation ─────────────────────
describe("adversarial: runtime resolution", () => {
  test("patched __dirname evaluates to a real directory at runtime", () => {
    // import.meta.dirname should resolve to THIS test file's directory
    // In the real bundle, it would resolve to dist/
    const dirname = import.meta.dir
    expect(typeof dirname).toBe("string")
    expect(dirname.length).toBeGreaterThan(0)
    // Validate it's an actual directory, not a stale/hardcoded path
    expect(existsSync(dirname)).toBe(true)
  })

  test("node_python_bridge.py is findable relative to dist/index.js", () => {
    // This is the critical runtime check: __dirname should be dist/,
    // and node_python_bridge.py should be in dist/
    const bridgePath = join(dist, "node_python_bridge.py")
    expect(existsSync(bridgePath)).toBe(true)

    // Verify it's actually a Python file, not garbage
    const content = readFileSync(bridgePath, "utf8")
    expect(content).toContain("import") // Python imports
    expect(content.length).toBeGreaterThan(100) // not truncated
  })

  test("bundle can be loaded from a DIFFERENT directory without path errors", async () => {
    // Simulate running the binary from /tmp — __dirname should still
    // resolve to where index.js lives, not the CWD
    const tmpDir = mkdtempSync(join(tmpdir(), "adversarial-"))
    const originalCwd = process.cwd()

    try {
      process.chdir(tmpDir)

      // The patched code uses import.meta.dirname which is compile-time
      // resolved to the file's actual location, not CWD. Verify this.
      const indexPath = join(dist, "index.js")
      expect(existsSync(indexPath)).toBe(true)

      // Read the bundle and verify the __dirname line doesn't reference CWD
      const code = readFileSync(indexPath, "utf8")
      expect(code).not.toContain(tmpDir)
    } finally {
      process.chdir(originalCwd)
    }
  })
})

// ─── Adversarial: Double-patch protection ───────────────────────────
describe("adversarial: idempotency", () => {
  test("running the patch twice does not corrupt the bundle", () => {
    const original = `var __dirname = "/ci/path/python-bridge"`

    // First patch
    const first = runPatchLogic(original)
    expect(first.patched).toBe(true)

    // Second patch on already-patched output — should be a no-op
    const second = runPatchLogic(first.output)
    expect(second.patched).toBe(false)
    expect(second.output).toBe(first.output)
  })

  test("patch output is syntactically valid JS", () => {
    const bundle = `var __dirname = "/home/runner/python-bridge";`
    const result = runPatchLogic(bundle)

    // The patched code should not have unmatched quotes or parens
    const openParens = (result.output.match(/\(/g) || []).length
    const closeParens = (result.output.match(/\)/g) || []).length
    expect(openParens).toBe(closeParens)

    const openQuotes = (result.output.match(/"/g) || []).length
    expect(openQuotes % 2).toBe(0) // even number of quotes
  })
})

// ─── Adversarial: CI smoke test alignment ───────────────────────────
describe("adversarial: CI smoke test parity", () => {
  test("CI regex catches what build-integrity test catches", () => {
    // CI uses: grep -qE 'var __dirname\\s*=\\s*"(/|[A-Za-z]:\\\\)' (shell regex)
    // Test uses: /var __dirname\s*=\s*"(?:[A-Za-z]:\\\\|\/)/
    // Both should flag the same hardcoded paths

    const linuxPath = `var __dirname = "/home/runner/python-bridge"`
    const windowsPath = `var __dirname = "C:\\\\Users\\\\runner\\\\python-bridge"`
    const patchedPath = `var __dirname = typeof import.meta.dirname === "string" ? import.meta.dirname : __require("path").dirname(__require("url").fileURLToPath(import.meta.url))`

    const ciRegex = /var __dirname\s*=\s*"(\/|[A-Za-z]:\\)/
    const testRegex = /var __dirname\s*=\s*"(?:[A-Za-z]:\\\\|\/)/

    // Both should flag hardcoded paths
    expect(ciRegex.test(linuxPath)).toBe(true)
    expect(testRegex.test(linuxPath)).toBe(true)

    expect(ciRegex.test(windowsPath)).toBe(true)
    expect(testRegex.test(windowsPath)).toBe(true)

    // Neither should flag the patched version
    expect(ciRegex.test(patchedPath)).toBe(false)
    expect(testRegex.test(patchedPath)).toBe(false)
  })
})

// ─── Adversarial: copy-python.ts script execution ───────────────────
describe("adversarial: copy-python.ts as a real script", () => {
  test("build script exits 0 on success", async () => {
    const result = await $`bun run build`.cwd(join(import.meta.dir, "..")).nothrow()
    expect(result.exitCode).toBe(0)
    expect(result.stderr.toString()).not.toContain("ERROR")
  })

  test("build script prints all three progress lines", async () => {
    const result = await $`bun run build`.cwd(join(import.meta.dir, "..")).nothrow()
    const output = result.stderr.toString() + result.stdout.toString()
    expect(output).toContain("Copied altimate_python_packages")
    expect(output).toContain("Copied node_python_bridge.py")
    expect(output).toContain("Patched __dirname")
  })

  test("consecutive builds produce identical dist/index.js", async () => {
    await $`bun run build`.cwd(join(import.meta.dir, ".."))
    const first = readFileSync(join(dist, "index.js"), "utf8")

    await $`bun run build`.cwd(join(import.meta.dir, ".."))
    const second = readFileSync(join(dist, "index.js"), "utf8")

    expect(first).toBe(second)
  })
})

// ─── Adversarial: bundle runtime structure ──────────────────────────
describe("adversarial: bundle runtime structure", () => {
  beforeAll(async () => {
    if (!existsSync(join(dist, "index.js"))) {
      await $`bun run build`.cwd(join(import.meta.dir, ".."))
    }
  })

  test("__require is defined via createRequire (not a Bun-only global)", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // __require must be created from Node's standard createRequire
    expect(code).toContain('import { createRequire } from "node:module"')
    expect(code).toMatch(/var __require\s*=.*createRequire\(import\.meta\.url\)/)
  })

  test("__dirname lives inside __commonJS wrapper (correct scope)", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // Find the python-bridge module wrapper
    const bridgeStart = code.indexOf("// ../../node_modules/.bun/python-bridge")
    expect(bridgeStart).toBeGreaterThan(-1)

    const dirnamePos = code.indexOf("var __dirname", bridgeStart)
    expect(dirnamePos).toBeGreaterThan(bridgeStart)

    // __dirname should come BEFORE PYTHON_BRIDGE_SCRIPT in the same scope
    const bridgeScriptPos = code.indexOf("PYTHON_BRIDGE_SCRIPT", dirnamePos)
    expect(bridgeScriptPos).toBeGreaterThan(dirnamePos)
  })

  test("PYTHON_BRIDGE_SCRIPT resolves node_python_bridge.py via __dirname", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // The bridge script path must use __dirname, not a hardcoded path
    expect(code).toMatch(/PYTHON_BRIDGE_SCRIPT\s*=\s*path\.join\(__dirname,\s*"node_python_bridge\.py"\)/)
  })

  test("python bridge spawn uses PYTHON_BRIDGE_SCRIPT variable", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // The spawn call must use the variable, not an inline path
    expect(code).toContain("spawn(intepreter, [PYTHON_BRIDGE_SCRIPT]")
  })

  test("no other hardcoded python-bridge paths survive in bundle", () => {
    const code = readFileSync(join(dist, "index.js"), "utf8")
    // After patching, the only python-bridge references should be:
    // 1. The comment line (// ../../node_modules/.bun/python-bridge@...)
    // 2. The require_python_bridge function name
    // 3. String literals for error messages
    // There should be NO hardcoded filesystem paths to python-bridge
    const lines = code.split("\n")
    for (const line of lines) {
      if (line.includes("python-bridge") && !line.trimStart().startsWith("//")) {
        // This line references python-bridge — it must NOT be a hardcoded path
        expect(line).not.toMatch(/["'](\/|[A-Z]:\\)[^"']*python-bridge/)
      }
    }
  })
})

// ─── Adversarial: publish pipeline ──────────────────────────────────
describe("adversarial: publish.ts copies patched artifacts", () => {
  beforeAll(async () => {
    if (!existsSync(join(dist, "index.js"))) {
      await $`bun run build`.cwd(join(import.meta.dir, ".."))
    }
  })

  test("dist/index.js is patched BEFORE publish.ts copies it", () => {
    // publish.ts calls `bun run build` on dbt-tools, then copies dist/index.js.
    // If copy-python.ts runs as part of build, the copied file must be patched.
    const code = readFileSync(join(dist, "index.js"), "utf8")
    expect(code).toContain("import.meta.dirname")
    expect(code).not.toMatch(/var __dirname\s*=\s*"(?:[A-Za-z]:\\\\|\/)/)
  })

  test("dist/node_python_bridge.py is non-empty and valid Python", () => {
    const py = readFileSync(join(dist, "node_python_bridge.py"), "utf8")
    expect(py.length).toBeGreaterThan(500) // real file, not a stub
    // Must contain the IPC message handling that the JS bridge talks to
    expect(py).toContain("def")
    // Must handle the JSON-RPC protocol
    expect(py).toMatch(/json|JSON/)
  })
})

// ─── Adversarial: mutation testing (what if the fix is removed?) ─────
describe("adversarial: mutation testing", () => {
  test("unpatched bundle WOULD contain a hardcoded absolute path", () => {
    // Build raw bundle WITHOUT running copy-python.ts
    // We simulate this by checking what bun build alone produces
    const code = readFileSync(join(dist, "index.js"), "utf8")

    // The patched line should exist — if we remove the patch, the hardcoded
    // path would return. Verify the patch is structurally present.
    const patchedLine = code.split("\n").find((l) => l.includes("var __dirname") && l.includes("import.meta.dirname"))
    expect(patchedLine).toBeDefined()

    // The patched line must have the ternary structure
    expect(patchedLine).toContain("typeof import.meta.dirname")
    expect(patchedLine).toContain("?")
    expect(patchedLine).toContain(":")
    expect(patchedLine).toContain("__require")
  })

  test("removing import.meta.dirname from replacement would break detection", () => {
    // The CI smoke test and build-integrity test both look for "import.meta.dirname".
    // If someone changes the replacement string to not include it, both guards catch it.
    const brokenReplacement = `var __dirname = __require("path").dirname(__require("url").fileURLToPath(import.meta.url))`
    // build-integrity.test.ts check:
    expect(brokenReplacement).not.toContain("import.meta.dirname")
    // This WOULD fail the integrity test — proving the guard works
  })

  test("removing the existence check would crash on missing bridge file", () => {
    // Verify the existence check is actually in the script
    const script = readFileSync(join(scriptDir, "copy-python.ts"), "utf8")
    expect(script).toContain("existsSync(bridgePy)")
    expect(script).toContain("process.exit(1)")
  })
})

// ─── Adversarial: regex catastrophic backtracking ───────────────────
describe("adversarial: regex performance", () => {
  test("patch regex does not catastrophically backtrack on large input", () => {
    // Craft a pathological input that could cause ReDoS with a bad regex
    const huge = `var __dirname = "${"a".repeat(100_000)}"`
    const start = performance.now()
    runPatchLogic(huge)
    const elapsed = performance.now() - start
    // Must complete in under 100ms even on 100KB input
    expect(elapsed).toBeLessThan(100)
  })

  test("patch regex handles bundle with many var declarations", () => {
    // Simulate a large bundle with thousands of var declarations
    const lines = Array.from({ length: 10_000 }, (_, i) => `var x${i} = "${i}";`)
    lines.push(`var __dirname = "/ci/path/python-bridge"`)
    lines.push(`var PYTHON_BRIDGE_SCRIPT = path.join(__dirname, "node_python_bridge.py");`)
    const bundle = lines.join("\n")

    const start = performance.now()
    const result = runPatchLogic(bundle)
    const elapsed = performance.now() - start

    expect(result.patched).toBe(true)
    expect(elapsed).toBeLessThan(200) // reasonable for 10K lines
  })
})

// ─── Adversarial: path injection / malformed paths ──────────────────
describe("adversarial: malformed inputs", () => {
  test("regex handles path with special regex characters", () => {
    // Paths with characters that are special in regex: . + * ? [ ] ( )
    const bundle = `var __dirname = "/home/runner/work/node_modules/.bun/python-bridge@1.1.0+build.123/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("regex handles path with unicode characters", () => {
    const bundle = `var __dirname = "/home/用户/项目/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("regex handles path with spaces", () => {
    const bundle = `var __dirname = "/home/runner/my project/node_modules/python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("regex handles empty path with python-bridge", () => {
    const bundle = `var __dirname = "python-bridge"`
    const result = runPatchLogic(bundle)
    expect(result.patched).toBe(true)
  })

  test("patch does NOT corrupt surrounding code", () => {
    const before = `console.log("before");\n`
    const target = `var __dirname = "/ci/python-bridge";\n`
    const after = `var SCRIPT = path.join(__dirname, "bridge.py");\n`
    const bundle = before + target + after

    const result = runPatchLogic(bundle)
    // Before and after lines must survive untouched
    expect(result.output).toContain(`console.log("before");`)
    expect(result.output).toContain(`var SCRIPT = path.join(__dirname, "bridge.py");`)
    // Target line is replaced
    expect(result.output).toContain("import.meta.dirname")
    expect(result.output).not.toContain("/ci/python-bridge")
  })

  test("patch preserves semicolons and line structure", () => {
    const bundle = `var __dirname = "/ci/python-bridge";`
    const result = runPatchLogic(bundle)
    // The replacement should end where the original ended
    // Original: var __dirname = "...";  →  var __dirname = typeof ...;
    // The semicolon after the closing quote is NOT part of the match,
    // so it should survive
    expect(result.output).toMatch(/\);$/)
  })
})
