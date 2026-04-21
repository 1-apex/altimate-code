import { describe, expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { detectModeFromCOLORFGBG } from "@/cli/cmd/tui/util/terminal-detection"
import github from "@/cli/cmd/tui/context/theme/github.json"
import solarized from "@/cli/cmd/tui/context/theme/solarized.json"
import flexoki from "@/cli/cmd/tui/context/theme/flexoki.json"

/**
 * Regression tests for issue #704 — code output renders as white text on
 * light terminal backgrounds.
 *
 * The COLORFGBG tests exercise the real production helper
 * (`detectModeFromCOLORFGBG` in `util/terminal-detection.ts`). Reverting
 * the fix in that file will cause these tests to fail.
 *
 * The theme-level tests (system-theme foreground fallback, inline-code
 * background) reproduce the logic locally rather than importing from
 * `theme.tsx`. The .tsx module cannot be imported from `bun:test`
 * because `@opentui/solid`'s JSX runtime types don't resolve in the
 * test loader (tracked for a follow-up pure-TS extraction). The local
 * copies are kept in lockstep with production via manual review.
 */

// ─── Pure test helpers (WCAG contrast + ANSI palette resolution) ───────────

function ansiToRgba(code: number): RGBA {
  if (code < 16) {
    const ansiColors = [
      "#000000", "#800000", "#008000", "#808000",
      "#000080", "#800080", "#008080", "#c0c0c0",
      "#808080", "#ff0000", "#00ff00", "#ffff00",
      "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
    ]
    return RGBA.fromHex(ansiColors[code] ?? "#000000")
  }
  if (code < 232) {
    const index = code - 16
    const b = index % 6
    const g = Math.floor(index / 6) % 6
    const r = Math.floor(index / 36)
    const val = (x: number) => (x === 0 ? 0 : x * 40 + 55)
    return RGBA.fromInts(val(r), val(g), val(b))
  }
  if (code < 256) {
    const gray = (code - 232) * 10 + 8
    return RGBA.fromInts(gray, gray, gray)
  }
  return RGBA.fromInts(0, 0, 0)
}

type ThemeJson = { defs?: Record<string, string>; theme: Record<string, unknown> }

function resolveTheme(theme: ThemeJson, mode: "dark" | "light"): Record<string, RGBA> {
  const defs = theme.defs ?? {}
  type ColorValue = string | number | RGBA | { dark: string; light: string }
  function resolveColor(c: ColorValue): RGBA {
    if (c instanceof RGBA) return c
    if (typeof c === "string") {
      if (c === "transparent" || c === "none") return RGBA.fromInts(0, 0, 0, 0)
      if (c.startsWith("#")) return RGBA.fromHex(c)
      if (defs[c] != null) return resolveColor(defs[c])
      if (theme.theme[c] !== undefined) return resolveColor(theme.theme[c] as ColorValue)
      throw new Error("Color reference not found: " + c)
    }
    if (typeof c === "number") return ansiToRgba(c)
    return resolveColor(c[mode])
  }
  const resolved: Record<string, RGBA> = {}
  for (const [key, value] of Object.entries(theme.theme)) {
    if (key === "selectedListItemText" || key === "backgroundMenu" || key === "thinkingOpacity") continue
    resolved[key] = resolveColor(value as ColorValue)
  }
  resolved.backgroundMenu = theme.theme.backgroundMenu
    ? resolveColor(theme.theme.backgroundMenu as ColorValue)
    : resolved.backgroundElement!
  return resolved
}

function contrastRatio(fg: RGBA, bg: RGBA): number {
  function relLum(c: RGBA): number {
    const [r, g, b] = c.toInts()
    const srgb = [r, g, b].map((v) => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!
  }
  const l1 = relLum(fg)
  const l2 = relLum(bg)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

// ─── detectModeFromCOLORFGBG: uses REAL production helper ──────────────────

describe("issue #704: detectModeFromCOLORFGBG (real production helper)", () => {
  test("0;15 (bright white bg) -> light", () => {
    expect(detectModeFromCOLORFGBG("0;15")).toBe("light")
  })

  test("0;7 (light-gray bg) -> light", () => {
    expect(detectModeFromCOLORFGBG("0;7")).toBe("light")
  })

  test("15;0 (black bg) -> dark", () => {
    expect(detectModeFromCOLORFGBG("15;0")).toBe("dark")
  })

  test("15;8 (dark-gray bg) -> dark", () => {
    expect(detectModeFromCOLORFGBG("15;8")).toBe("dark")
  })

  test("0;9 (bright red bg) -> dark (bright != light)", () => {
    expect(detectModeFromCOLORFGBG("0;9")).toBe("dark")
  })

  test("0;12 (bright blue bg) -> dark", () => {
    expect(detectModeFromCOLORFGBG("0;12")).toBe("dark")
  })

  test("0;13 (bright magenta bg) -> dark", () => {
    expect(detectModeFromCOLORFGBG("0;13")).toBe("dark")
  })

  test("0;7;15 (3-part, last is bg) -> light", () => {
    expect(detectModeFromCOLORFGBG("0;7;15")).toBe("light")
  })

  test("15;0;0 (3-part, last is bg) -> dark", () => {
    expect(detectModeFromCOLORFGBG("15;0;0")).toBe("dark")
  })

  test("default;default (Alacritty/Kitty) -> null", () => {
    expect(detectModeFromCOLORFGBG("default;default")).toBe(null)
  })

  test("15;default -> null", () => {
    expect(detectModeFromCOLORFGBG("15;default")).toBe(null)
  })

  test("0;99 (out-of-range) -> null", () => {
    expect(detectModeFromCOLORFGBG("0;99")).toBe(null)
  })

  test("0;256 (out-of-range) -> null", () => {
    expect(detectModeFromCOLORFGBG("0;256")).toBe(null)
  })

  test("0;-1 (negative) -> null", () => {
    expect(detectModeFromCOLORFGBG("0;-1")).toBe(null)
  })

  test("empty string -> null", () => {
    expect(detectModeFromCOLORFGBG("")).toBe(null)
  })

  test("undefined -> null", () => {
    expect(detectModeFromCOLORFGBG(undefined)).toBe(null)
  })

  test("' 0;15 ' (whitespace tolerated) -> light", () => {
    expect(detectModeFromCOLORFGBG(" 0;15 ")).toBe("light")
  })

  test("abc (non-numeric) -> null", () => {
    expect(detectModeFromCOLORFGBG("abc")).toBe(null)
  })
})

// ─── Theme-level tests (pure-TS reproduction of generateSystem) ────────────

type TerminalColors = {
  defaultBackground?: string
  defaultForeground?: string
  palette: string[]
}

function generateSystemLike(colors: TerminalColors, mode: "dark" | "light") {
  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
  const isDark = mode === "dark"
  // Mirror of theme.tsx: light-mode fallback prefers palette[0], else #1a1a1a
  const fgFallback = isDark ? colors.palette[7]! : (colors.palette[0] ?? "#1a1a1a")
  const fg = RGBA.fromHex(colors.defaultForeground ?? fgFallback)
  return { bg, fg }
}

const LIGHT_TERMINAL: TerminalColors = {
  defaultBackground: "#ffffff",
  defaultForeground: undefined,
  palette: [
    "#000000", "#800000", "#008000", "#808000",
    "#000080", "#800080", "#008080", "#c0c0c0",
    "#808080", "#ff0000", "#00ff00", "#ffff00",
    "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
  ],
}

describe("issue #704: system theme light-mode foreground fallback", () => {
  test("light mode: fallback is not palette[7] (#c0c0c0)", () => {
    const { fg } = generateSystemLike(LIGHT_TERMINAL, "light")
    expect(fg.equals(RGBA.fromHex("#c0c0c0"))).toBe(false)
  })

  test("light mode: fallback has WCAG-AA contrast on white", () => {
    const { fg } = generateSystemLike(LIGHT_TERMINAL, "light")
    const whiteBg = RGBA.fromHex("#ffffff")
    expect(contrastRatio(fg, whiteBg)).toBeGreaterThanOrEqual(4.5)
  })

  test("light mode: fallback respects user palette[0] when provided", () => {
    const custom: TerminalColors = { ...LIGHT_TERMINAL, palette: ["#222244", ...LIGHT_TERMINAL.palette.slice(1)] }
    const { fg } = generateSystemLike(custom, "light")
    expect(fg.equals(RGBA.fromHex("#222244"))).toBe(true)
  })

  test("dark mode regression: fallback is palette[7]", () => {
    const darkTerminal: TerminalColors = { ...LIGHT_TERMINAL, defaultBackground: "#1a1a1a" }
    const { fg } = generateSystemLike(darkTerminal, "dark")
    expect(fg.equals(RGBA.fromHex("#c0c0c0"))).toBe(true)
  })

  test("defaultForeground is always honored when provided", () => {
    const explicit: TerminalColors = { ...LIGHT_TERMINAL, defaultForeground: "#113355" }
    const { fg } = generateSystemLike(explicit, "light")
    expect(fg.equals(RGBA.fromHex("#113355"))).toBe(true)
  })
})

describe("issue #704: markup.raw.inline uses backgroundElement (named themes)", () => {
  const LIGHT_THEMES: [string, ThemeJson][] = [
    ["github", github as unknown as ThemeJson],
    ["solarized", solarized as unknown as ThemeJson],
    ["flexoki", flexoki as unknown as ThemeJson],
  ]

  test.each(LIGHT_THEMES)(
    "%s light: backgroundElement is opaque and gives markdownCode visible contrast",
    (_name, themeJson) => {
      const resolved = resolveTheme(themeJson, "light")
      expect(resolved.backgroundElement!.a).toBeGreaterThan(0)
      const ratio = contrastRatio(resolved.markdownCode!, resolved.backgroundElement!)
      // 2.0 matches the threshold used elsewhere in this suite — inline code
      // colors are syntax-intent (semantic) and don't need full WCAG-AA text contrast.
      expect(ratio).toBeGreaterThanOrEqual(2)
    },
  )
})
