import z from "zod"
import { monotonicFactory, decodeTime } from "ulid"

const ulid = monotonicFactory()

export namespace Identifier {
  const prefixes = {
    session: "ses",
    message: "msg",
    permission: "per",
    question: "que",
    user: "usr",
    part: "prt",
    pty: "pty",
    tool: "tool",
  } as const

  // Crockford base32 alphabet used by ULID
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

  // Invert each character within the Crockford alphabet so the ID sorts in reverse chronological order
  function invert(id: string): string {
    return id
      .split("")
      .map((c) => {
        const idx = CROCKFORD.indexOf(c.toUpperCase())
        return idx === -1 ? c : CROCKFORD[31 - idx]
      })
      .join("")
  }

  export function schema(prefix: keyof typeof prefixes) {
    return z.string().startsWith(prefixes[prefix])
  }

  export function ascending(prefix: keyof typeof prefixes, given?: string): string {
    if (given) {
      if (!given.startsWith(prefixes[prefix])) throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
      return given
    }
    return prefixes[prefix] + "_" + ulid()
  }

  export function descending(prefix: keyof typeof prefixes, given?: string): string {
    if (given) {
      if (!given.startsWith(prefixes[prefix])) throw new Error(`ID ${given} does not start with ${prefixes[prefix]}`)
      return given
    }
    return prefixes[prefix] + "_" + invert(ulid())
  }

  export function create(prefix: keyof typeof prefixes, desc: boolean, timestamp?: number): string {
    const id = ulid(timestamp)
    return prefixes[prefix] + "_" + (desc ? invert(id) : id)
  }

  /** Extract timestamp from an ascending ID. Does not work with descending IDs. */
  export function timestamp(id: string): number {
    const ulidPart = id.slice(id.indexOf("_") + 1)
    if (ulidPart.charCodeAt(0) > "9".charCodeAt(0)) {
      throw new Error("timestamp() does not work with descending IDs")
    }
    return decodeTime(ulidPart)
  }
}
