#!/bin/bash
# Phase 3: Resilience tests — SQLite, compaction, error recovery
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"
source "$SCRIPT_DIR/lib/altimate-run.sh"

echo "--- Phase 3: Resilience Tests ---"

# Need an API key for most resilience tests
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "  WARNING: ANTHROPIC_API_KEY not set — running limited resilience tests"
fi

# Set up a git repo for project context
WORKDIR=$(mktemp -d /tmp/sanity-resilience-XXXXXX)
cd "$WORKDIR" || { echo "FAIL: cannot cd to $WORKDIR"; exit 1; }
git init -q
git config user.name "sanity-test"
git config user.email "sanity@test.local"
echo '{}' > package.json
git add -A && git commit -q -m "init"

# 1. SQLite DB created after first run
echo "  [1/7] SQLite DB creation..."
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  altimate_run "db-create" "say hello" || true
  # Find the DB — could be opencode.db, opencode-latest.db, or opencode-{channel}.db
  DB_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/altimate-code"
  DB_PATH=$(find "$DB_DIR" -name "opencode*.db" -not -name "*-wal" -not -name "*-shm" 2>/dev/null | head -1)
  if [ -n "$DB_PATH" ]; then
    assert_file_exists "$DB_PATH" "session DB created ($(basename "$DB_PATH"))"
  else
    echo "  FAIL: no opencode*.db found in $DB_DIR"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    DB_PATH=""
  fi
else
  skip_test "SQLite DB creation" "no ANTHROPIC_API_KEY"
  DB_PATH=""
fi

# 2. WAL mode enabled
echo "  [2/7] WAL mode..."
if [ -n "$DB_PATH" ] && [ -f "$DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
  WAL_MODE=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode;" 2>/dev/null || echo "unknown")
  assert_eq "$WAL_MODE" "wal" "WAL mode enabled"
else
  skip_test "WAL mode" "DB not available or sqlite3 not installed"
fi

# 3. Session persisted
echo "  [3/7] Session persistence..."
if [ -n "$DB_PATH" ] && [ -f "$DB_PATH" ] && command -v sqlite3 >/dev/null 2>&1; then
  SESSION_COUNT=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM session;" 2>/dev/null || echo "0")
  assert_ge "$SESSION_COUNT" 1 "session persisted (got $SESSION_COUNT)"
else
  skip_test "Session persistence" "DB not available"
fi

# 4. Session continue (DB survives restart)
echo "  [4/7] Session continue..."
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  altimate_run "continue" --continue "what was my last message" || true
  assert_not_contains "$(get_output continue)" "TIMEOUT" "session continue works"
else
  skip_test "Session continue" "no ANTHROPIC_API_KEY"
fi

# 5. Compaction doesn't crash (best-effort — seed if fixture available)
echo "  [5/7] Compaction resilience..."
if [ -n "$DB_PATH" ] && [ -f "$SCRIPT_DIR/fixtures/compaction-session.sql" ] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" < "$SCRIPT_DIR/fixtures/compaction-session.sql" 2>/dev/null || true
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    altimate_run_with_turns "compaction" 3 --continue "continue working" || true
    # Check it didn't crash with unhandled error (timeout is acceptable)
    comp_output=$(get_output "compaction")
    if echo "$comp_output" | grep -qi "TypeError\|Cannot read properties\|unhandled"; then
      echo "  FAIL: compaction crashed with unhandled error"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    else
      echo "  PASS: compaction did not crash"
      PASS_COUNT=$((PASS_COUNT + 1))
    fi
  else
    skip_test "Compaction resilience" "no ANTHROPIC_API_KEY"
  fi
else
  skip_test "Compaction resilience" "fixture or sqlite3 not available"
fi

# 6. Graceful on missing provider key
echo "  [6/7] Missing API key handling..."
SAVED_KEY="${ANTHROPIC_API_KEY:-}"
unset ANTHROPIC_API_KEY
OUTPUT=$(timeout 10 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
# Should get a clean error, not an unhandled exception / stack trace
assert_not_contains "$OUTPUT" "TypeError" "no TypeError on missing key"
assert_not_contains "$OUTPUT" "Cannot read properties" "no unhandled error on missing key"
if [ -n "$SAVED_KEY" ]; then
  export ANTHROPIC_API_KEY="$SAVED_KEY"
fi

# 7. Config backwards compatibility
echo "  [7/7] Config backwards compat..."
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/altimate-code"
mkdir -p "$CONFIG_DIR"
if [ -f "$SCRIPT_DIR/fixtures/old-config.json" ]; then
  cp "$SCRIPT_DIR/fixtures/old-config.json" "$CONFIG_DIR/opencode.json"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    altimate_run "old-config" "say hello" || true
    assert_not_contains "$(get_output old-config)" "parse error" "old config loads without parse error"
  else
    skip_test "Config backwards compat" "no ANTHROPIC_API_KEY"
  fi
  rm -f "$CONFIG_DIR/opencode.json"
else
  skip_test "Config backwards compat" "old-config.json fixture not found"
fi

# 8. Broken config graceful handling
echo "  [8/8] Broken config handling..."
if [ -f "$SCRIPT_DIR/fixtures/broken-config.json" ]; then
  cp "$SCRIPT_DIR/fixtures/broken-config.json" "$CONFIG_DIR/opencode.json"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    altimate_run "broken-config" "say hello" || true
    assert_not_contains "$(get_output broken-config)" "stack trace" "broken config handled gracefully"
  else
    OUTPUT=$(timeout 10 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
    assert_not_contains "$OUTPUT" "SyntaxError" "broken config no SyntaxError"
  fi
  rm -f "$CONFIG_DIR/opencode.json"
else
  skip_test "Broken config handling" "broken-config.json fixture not found"
fi

# Cleanup
rm -rf "$WORKDIR"

report_results "Phase 3: Resilience Tests"
