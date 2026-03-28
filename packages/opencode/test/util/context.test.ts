import { describe, test, expect } from "bun:test"
import { Context } from "../../src/util/context"

describe("Context: provide and use", () => {
  test("use() returns provided value", () => {
    const ctx = Context.create<{ id: number }>("test")
    const result = ctx.provide({ id: 42 }, () => ctx.use())
    expect(result).toEqual({ id: 42 })
  })

  test("use() throws NotFound outside provider", () => {
    const ctx = Context.create<{ id: number }>("myctx")
    expect(() => ctx.use()).toThrow(Context.NotFound)
    expect(() => ctx.use()).toThrow("No context found for myctx")
  })

  test("nested provide uses innermost value", () => {
    const ctx = Context.create<{ val: string }>("nest")
    const result = ctx.provide({ val: "outer" }, () =>
      ctx.provide({ val: "inner" }, () => ctx.use().val),
    )
    expect(result).toBe("inner")
  })

  test("provide passes through callback return value", () => {
    const ctx = Context.create<{ val: string }>("passthrough")
    const result = ctx.provide({ val: "x" }, () => 42)
    expect(result).toBe(42)
  })

  test("concurrent contexts are isolated", async () => {
    const ctx = Context.create<{ id: number }>("concurrent")
    const results = await Promise.all([
      ctx.provide({ id: 1 }, async () => {
        await new Promise((r) => setTimeout(r, 10))
        return ctx.use().id
      }),
      ctx.provide({ id: 2 }, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return ctx.use().id
      }),
    ])
    expect(results).toEqual([1, 2])
  })
})
