import { describe, test, expect } from "bun:test"
import { Keybind } from "../../src/util/keybind"

// ---------------------------------------------------------------------------
// Keybind.parse
// ---------------------------------------------------------------------------

describe("Keybind.parse", () => {
  test("parses simple key", () => {
    const result = Keybind.parse("a")
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
    })
  })

  test("parses ctrl modifier", () => {
    const [key] = Keybind.parse("ctrl+a")
    expect(key.ctrl).toBe(true)
    expect(key.name).toBe("a")
  })

  test("parses alt/meta/option as meta", () => {
    expect(Keybind.parse("alt+x")[0].meta).toBe(true)
    expect(Keybind.parse("meta+x")[0].meta).toBe(true)
    expect(Keybind.parse("option+x")[0].meta).toBe(true)
  })

  test("parses multiple modifiers", () => {
    const [key] = Keybind.parse("ctrl+shift+a")
    expect(key.ctrl).toBe(true)
    expect(key.shift).toBe(true)
    expect(key.name).toBe("a")
  })

  test("parses super modifier", () => {
    const [key] = Keybind.parse("super+a")
    expect(key.super).toBe(true)
    expect(key.name).toBe("a")
  })

  test("parses leader key", () => {
    const [key] = Keybind.parse("<leader>a")
    expect(key.leader).toBe(true)
    expect(key.name).toBe("a")
  })

  test("parses comma-separated multiple bindings", () => {
    const result = Keybind.parse("ctrl+a,ctrl+b")
    expect(result).toHaveLength(2)
    expect(result[0].name).toBe("a")
    expect(result[1].name).toBe("b")
  })

  test("normalizes esc to escape", () => {
    const [key] = Keybind.parse("esc")
    expect(key.name).toBe("escape")
  })

  test("returns empty array for 'none'", () => {
    expect(Keybind.parse("none")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Keybind.match
// ---------------------------------------------------------------------------

describe("Keybind.match", () => {
  test("matches identical keys", () => {
    const key: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    expect(Keybind.match(key, key)).toBe(true)
  })

  test("returns false for undefined first arg", () => {
    const key: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    expect(Keybind.match(undefined, key)).toBe(false)
  })

  test("normalizes missing super field to false", () => {
    const a = { ctrl: false, meta: false, shift: false, leader: false, name: "x" } as Keybind.Info
    const b: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "x",
      super: false,
    }
    expect(Keybind.match(a, b)).toBe(true)
  })

  test("super: true vs super: false don't match", () => {
    const a: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: true,
    }
    const b: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    expect(Keybind.match(a, b)).toBe(false)
  })

  test("different modifiers don't match", () => {
    const a: Keybind.Info = {
      ctrl: true,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    const b: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    expect(Keybind.match(a, b)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Keybind.toString
// ---------------------------------------------------------------------------

describe("Keybind.toString", () => {
  test("returns empty string for undefined", () => {
    expect(Keybind.toString(undefined)).toBe("")
  })

  test("formats simple key", () => {
    const key: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "a",
      super: false,
    }
    expect(Keybind.toString(key)).toBe("a")
  })

  test("formats modifiers in order: ctrl+alt+super+shift", () => {
    const key: Keybind.Info = {
      ctrl: true,
      meta: true,
      shift: true,
      leader: false,
      name: "a",
      super: true,
    }
    expect(Keybind.toString(key)).toBe("ctrl+alt+super+shift+a")
  })

  test("formats leader prefix", () => {
    const key: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: true,
      name: "a",
      super: false,
    }
    expect(Keybind.toString(key)).toBe("<leader> a")
  })

  test("maps delete to del", () => {
    const key: Keybind.Info = {
      ctrl: false,
      meta: false,
      shift: false,
      leader: false,
      name: "delete",
      super: false,
    }
    expect(Keybind.toString(key)).toBe("del")
  })
})

// ---------------------------------------------------------------------------
// Keybind.fromParsedKey
// ---------------------------------------------------------------------------

describe("Keybind.fromParsedKey", () => {
  test("normalizes space to 'space'", () => {
    const parsed = { name: " ", ctrl: false, meta: false, shift: false, super: false }
    const result = Keybind.fromParsedKey(parsed as any)
    expect(result.name).toBe("space")
  })

  test("sets leader flag when passed", () => {
    const parsed = { name: "a", ctrl: false, meta: false, shift: false, super: false }
    const result = Keybind.fromParsedKey(parsed as any, true)
    expect(result.leader).toBe(true)
  })

  test("defaults leader to false", () => {
    const parsed = { name: "a", ctrl: false, meta: false, shift: false, super: false }
    const result = Keybind.fromParsedKey(parsed as any)
    expect(result.leader).toBe(false)
  })
})
