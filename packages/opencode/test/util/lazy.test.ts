import { describe, expect, test } from "bun:test"
import { lazy } from "../../src/util/lazy"

describe("util.lazy", () => {
  test("should call function only once", () => {
    let callCount = 0
    const getValue = () => {
      callCount++
      return "expensive value"
    }

    const lazyValue = lazy(getValue)

    expect(callCount).toBe(0)

    const result1 = lazyValue()
    expect(result1).toBe("expensive value")
    expect(callCount).toBe(1)

    const result2 = lazyValue()
    expect(result2).toBe("expensive value")
    expect(callCount).toBe(1)
  })

  test("should preserve the same reference", () => {
    const obj = { value: 42 }
    const lazyObj = lazy(() => obj)

    const result1 = lazyObj()
    const result2 = lazyObj()

    expect(result1).toBe(obj)
    expect(result2).toBe(obj)
    expect(result1).toBe(result2)
  })

  // altimate_change start — test reset() and error-retry behavior
  test("reset() clears cached value and re-invokes factory", () => {
    let count = 0
    const getValue = lazy(() => ++count)

    expect(getValue()).toBe(1)
    expect(getValue()).toBe(1) // cached

    getValue.reset()

    expect(getValue()).toBe(2) // re-invoked
    expect(getValue()).toBe(2) // cached again
  })

  test("factory error is not cached — retries on next call", () => {
    let shouldFail = true
    const getValue = lazy(() => {
      if (shouldFail) throw new Error("transient failure")
      return "success"
    })

    expect(() => getValue()).toThrow("transient failure")

    shouldFail = false
    expect(getValue()).toBe("success") // retries and succeeds
    expect(getValue()).toBe("success") // now cached
  })

  test("reset() after error allows fresh initialization", () => {
    let attempt = 0
    const getValue = lazy(() => {
      attempt++
      if (attempt === 1) throw new Error("first call fails")
      return `attempt-${attempt}`
    })

    expect(() => getValue()).toThrow("first call fails")

    getValue.reset()
    expect(getValue()).toBe("attempt-2")
  })
  // altimate_change end

  test("should work with different return types", () => {
    const lazyString = lazy(() => "string")
    const lazyNumber = lazy(() => 123)
    const lazyBoolean = lazy(() => true)
    const lazyNull = lazy(() => null)
    const lazyUndefined = lazy(() => undefined)

    expect(lazyString()).toBe("string")
    expect(lazyNumber()).toBe(123)
    expect(lazyBoolean()).toBe(true)
    expect(lazyNull()).toBe(null)
    expect(lazyUndefined()).toBe(undefined)
  })

})
