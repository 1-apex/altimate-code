#!/bin/bash
# PR-aware test generation: analyze git diff → emit test manifest
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${1:-origin/main}"
MANIFEST="/tmp/sanity-pr-manifest.txt"

> "$MANIFEST"

changed=$(git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || echo "")

if [ -z "$changed" ]; then
  # Distinguish "no changes" from "git failed"
  if ! git rev-parse --verify "$BASE" >/dev/null 2>&1 && ! git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
    echo "WARNING: Could not resolve base ref '$BASE' or HEAD~1 — git diff failed."
    echo "  Ensure 'origin/main' is fetched: git fetch origin main"
    exit 1
  fi
  echo "No changes detected — no PR-specific tests to generate."
  exit 0
fi

emit_test() {
  local name="$1"
  local cmd="$2"
  echo "$name|$cmd" >> "$MANIFEST"
  echo "  Generated: $name"
}

echo "--- PR-Aware Test Generation ---"
echo "  Base: $BASE"
echo "  Changed files: $(echo "$changed" | wc -l)"
echo ""

# New command template → test it resolves
echo "$changed" | grep "command/template/.*\.txt" 2>/dev/null | while read -r f; do
  cmd=$(basename "$f" .txt)
  emit_test "command-${cmd}" "altimate run --max-turns 1 --yolo --command ${cmd} test"
done

# Skill changed → test skill file exists in builtin
echo "$changed" | grep "skills/.*/SKILL.md" 2>/dev/null | while read -r f; do
  skill=$(basename "$(dirname "$f")")
  emit_test "skill-${skill}" "ls ~/.altimate/builtin/${skill}/SKILL.md"
done

# SQL tool changed → test sql_analyze
if echo "$changed" | grep -qE "sql|tools/sql-"; then
  emit_test "sql-smoke" "altimate run --max-turns 2 --yolo -f $SCRIPT_DIR/fixtures/test.sql 'analyze this SQL'"
fi

# postinstall/build changed → full install verification
if echo "$changed" | grep -qE "postinstall|build\.ts|publish\.ts"; then
  emit_test "verify-install" "$SCRIPT_DIR/phases/verify-install.sh"
fi

# provider changed → test provider init
if echo "$changed" | grep -q "provider/"; then
  emit_test "provider-init" "altimate run --max-turns 1 --yolo 'hello'"
fi

# session/compaction/storage changed → resilience
if echo "$changed" | grep -qE "session/|compaction|storage/"; then
  emit_test "resilience" "$SCRIPT_DIR/phases/resilience.sh"
fi

# config changed → backwards compat
if echo "$changed" | grep -q "config/"; then
  emit_test "config-compat" "$SCRIPT_DIR/phases/resilience.sh"
fi

# migration changed → flag for upgrade test
if echo "$changed" | grep -q "migration/"; then
  emit_test "upgrade-needed" "$SCRIPT_DIR/phases/verify-upgrade.sh"
fi

COUNT=$(wc -l < "$MANIFEST")
echo ""
echo "  Generated $COUNT PR-specific test(s)"
echo "  Manifest: $MANIFEST"
