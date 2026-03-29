import { describe, test, expect } from "bun:test"
import { SkillFollowups } from "../../src/skill/followups"

describe("SkillFollowups", () => {
  describe("get", () => {
    test("returns suggestions for known dbt skills", () => {
      const suggestions = SkillFollowups.get("dbt-develop")
      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions[0]).toHaveProperty("skill")
      expect(suggestions[0]).toHaveProperty("label")
      expect(suggestions[0]).toHaveProperty("description")
    })

    test("returns suggestions for dbt-troubleshoot", () => {
      const suggestions = SkillFollowups.get("dbt-troubleshoot")
      expect(suggestions.length).toBeGreaterThan(0)
      // First suggestion should be to add regression tests
      expect(suggestions[0].skill).toBe("dbt-test")
    })

    test("returns suggestions for sql-review", () => {
      const suggestions = SkillFollowups.get("sql-review")
      expect(suggestions.length).toBeGreaterThan(0)
    })

    test("returns empty array for unknown skill", () => {
      const suggestions = SkillFollowups.get("nonexistent-skill")
      expect(suggestions).toEqual([])
    })

    test("returns empty array for skills without followups", () => {
      const suggestions = SkillFollowups.get("teach")
      expect(suggestions).toEqual([])
    })
  })

  describe("format", () => {
    test("returns formatted follow-up section for dbt-develop", () => {
      const output = SkillFollowups.format("dbt-develop")
      expect(output).toContain("## What's Next?")
      expect(output).toContain("Add tests")
      expect(output).toContain("dbt-test")
      expect(output).toContain("Document your model")
      expect(output).toContain("dbt-docs")
      expect(output).toContain("/discover")
      expect(output).toContain("You can continue this conversation")
    })

    test("returns formatted follow-up section for dbt-troubleshoot", () => {
      const output = SkillFollowups.format("dbt-troubleshoot")
      expect(output).toContain("## What's Next?")
      expect(output).toContain("regression tests")
      expect(output).toContain("downstream")
    })

    test("returns empty string for skill without followups", () => {
      const output = SkillFollowups.format("nonexistent-skill")
      expect(output).toBe("")
    })

    test("format includes numbered suggestions", () => {
      const output = SkillFollowups.format("dbt-develop")
      expect(output).toContain("1.")
      expect(output).toContain("2.")
      expect(output).toContain("3.")
    })

    test("format includes warehouse nudge", () => {
      const output = SkillFollowups.format("dbt-develop")
      expect(output).toContain("Connect a warehouse")
      expect(output).toContain("/discover")
    })

    test("all dbt skills have follow-ups defined", () => {
      const dbtSkills = ["dbt-develop", "dbt-troubleshoot", "dbt-test", "dbt-docs", "dbt-analyze"]
      for (const skill of dbtSkills) {
        const suggestions = SkillFollowups.get(skill)
        expect(suggestions.length).toBeGreaterThan(0)
      }
    })

    test("follow-up suggestions reference valid skill names", () => {
      const KNOWN_SKILLS = [
        "dbt-develop",
        "dbt-troubleshoot",
        "dbt-test",
        "dbt-docs",
        "dbt-analyze",
        "sql-review",
        "sql-translate",
        "query-optimize",
        "cost-report",
        "pii-audit",
        "lineage-diff",
        "schema-migration",
        "data-viz",
        "altimate-setup",
        "teach",
        "train",
        "training-status",
      ]
      // Check all follow-up skills point to known skills
      for (const skillName of KNOWN_SKILLS) {
        const suggestions = SkillFollowups.get(skillName)
        for (const s of suggestions) {
          expect(KNOWN_SKILLS).toContain(s.skill)
        }
      }
    })

    test("no skill suggests itself as a follow-up", () => {
      const skills = [
        "dbt-develop",
        "dbt-troubleshoot",
        "dbt-test",
        "dbt-docs",
        "dbt-analyze",
        "sql-review",
        "sql-translate",
        "query-optimize",
        "cost-report",
      ]
      for (const skillName of skills) {
        const suggestions = SkillFollowups.get(skillName)
        for (const s of suggestions) {
          expect(s.skill).not.toBe(skillName)
        }
      }
    })
  })
})
