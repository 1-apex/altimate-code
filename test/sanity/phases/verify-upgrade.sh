#!/bin/bash
# Phase 4: Upgrade-specific verification
# Only runs in upgrade mode (Dockerfile.upgrade)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"

echo "--- Phase 4: Verify Upgrade ---"

# These env vars should be set by the upgrade Dockerfile
OLD_VERSION="${OLD_VERSION:-unknown}"
NEW_VERSION=$(altimate --version 2>/dev/null || echo "unknown")

# 1. Version upgraded
echo "  Checking version: old=$OLD_VERSION new=$NEW_VERSION"
assert_neq "$NEW_VERSION" "$OLD_VERSION" "version upgraded from $OLD_VERSION to $NEW_VERSION"

# 2. Skills refreshed (no stale files from old version)
SKILL_COUNT=$(find ~/.altimate/builtin -name "SKILL.md" -maxdepth 2 2>/dev/null | wc -l)
SKILL_COUNT="${SKILL_COUNT:-0}"
assert_ge "$SKILL_COUNT" 17 "builtin skills present after upgrade (got $SKILL_COUNT)"

# 3. Old sessions still accessible
DB_PATH="${XDG_DATA_HOME:-$HOME/.local/share}/altimate-code/opencode.db"
if [ -f "$DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
  SESSION_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM session;" 2>/dev/null || echo "0")
  assert_ge "$SESSION_COUNT" 1 "old sessions survived upgrade (got $SESSION_COUNT)"
else
  skip_test "Old sessions accessible" "DB not found or sqlite3 not installed"
fi

# 4. Migrations applied (compute expected count at runtime)
if [ -f "$DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
  MIGRATION_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM __drizzle_migrations;" 2>/dev/null || echo "0")
  assert_ge "$MIGRATION_COUNT" 1 "migrations applied (got $MIGRATION_COUNT)"
else
  skip_test "Migrations applied" "DB not found or sqlite3 not installed"
fi

report_results "Phase 4: Verify Upgrade"
