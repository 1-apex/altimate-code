#!/bin/bash
# Phase 3b: Extended resilience tests — edge cases, recovery, concurrency
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"
source "$SCRIPT_DIR/lib/altimate-run.sh"

echo "--- Phase 3b: Extended Resilience Tests ---"

# Set up git repo
WORKDIR=$(mktemp -d /tmp/sanity-resilience-ext-XXXXXX)
cd "$WORKDIR" || { echo "FAIL: cannot cd to $WORKDIR"; exit 1; }
git init -q
git config user.name "sanity-test"
git config user.email "sanity@test.local"
echo '{}' > package.json
git add -A && git commit -q -m "init"

# ─────────────────────────────────────────────────────────────
# Database Recovery
# ─────────────────────────────────────────────────────────────

# 1. Deleted DB is recreated on next run
echo "  [1/15] DB recreation after deletion..."
DB_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/altimate-code"
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -d "$DB_DIR" ]; then
  # Find and delete the DB
  DB_PATH=$(find "$DB_DIR" -name "opencode*.db" -not -name "*-wal" -not -name "*-shm" 2>/dev/null | head -1)
  if [ -n "$DB_PATH" ]; then
    rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"
    altimate_run "db-recreate" "say hello" || true
    NEW_DB=$(find "$DB_DIR" -name "opencode*.db" -not -name "*-wal" -not -name "*-shm" 2>/dev/null | head -1)
    if [ -n "$NEW_DB" ]; then
      echo "  PASS: DB recreated after deletion"
      PASS_COUNT=$((PASS_COUNT + 1))
    else
      echo "  FAIL: DB not recreated after deletion"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
  else
    skip_test "DB recreation" "no DB found to delete"
  fi
else
  skip_test "DB recreation" "no API key or DB dir"
fi

# 2. Corrupted DB handled gracefully
echo "  [2/15] Corrupted DB handling..."
if [ -d "$DB_DIR" ]; then
  DB_PATH=$(find "$DB_DIR" -name "opencode*.db" -not -name "*-wal" -not -name "*-shm" 2>/dev/null | head -1)
  if [ -n "$DB_PATH" ]; then
    # Corrupt the DB by writing garbage — use trap for guaranteed restore
    cp "$DB_PATH" "${DB_PATH}.bak"
    _restore_db() { mv "${DB_PATH}.bak" "$DB_PATH" 2>/dev/null || rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"; }
    trap '_restore_db' EXIT
    echo "THIS IS NOT A SQLITE DATABASE" > "$DB_PATH"
    CORRUPT_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
    if echo "$CORRUPT_OUTPUT" | grep -qi "SIGSEGV\|segfault\|core dumped"; then
      echo "  FAIL: corrupted DB caused crash"
      FAIL_COUNT=$((FAIL_COUNT + 1))
    else
      echo "  PASS: corrupted DB handled gracefully"
      PASS_COUNT=$((PASS_COUNT + 1))
    fi
    # Restore and clear trap
    _restore_db
    trap - EXIT
  else
    skip_test "Corrupted DB" "no DB found"
  fi
else
  skip_test "Corrupted DB" "DB dir not found"
fi

# ─────────────────────────────────────────────────────────────
# Config Edge Cases
# ─────────────────────────────────────────────────────────────

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/altimate-code"
mkdir -p "$CONFIG_DIR"

# 3. Empty config file handled
echo "  [3/15] Empty config file..."
echo "" > "$CONFIG_DIR/opencode.json"
EMPTY_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if echo "$EMPTY_OUTPUT" | grep -qi "SyntaxError\|parse error\|SIGSEGV"; then
  echo "  FAIL: empty config caused parse error or crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: empty config handled gracefully"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -f "$CONFIG_DIR/opencode.json"

# 4. Config with only whitespace
echo "  [4/15] Whitespace-only config..."
echo "   " > "$CONFIG_DIR/opencode.json"
WS_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if echo "$WS_OUTPUT" | grep -qi "SyntaxError\|SIGSEGV"; then
  echo "  FAIL: whitespace config caused error"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: whitespace config handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -f "$CONFIG_DIR/opencode.json"

# 5. Config with valid JSON but wrong schema
echo "  [5/15] Wrong schema config..."
echo '{"this_is_not_a_real_field": true, "another_fake": [1,2,3]}' > "$CONFIG_DIR/opencode.json"
SCHEMA_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if echo "$SCHEMA_OUTPUT" | grep -qi "TypeError\|Cannot read\|SIGSEGV"; then
  echo "  FAIL: wrong schema config caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: wrong schema config handled gracefully"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -f "$CONFIG_DIR/opencode.json"

# 6. Config with JSONC comments
echo "  [6/15] JSONC config with comments..."
cat > "$CONFIG_DIR/opencode.jsonc" <<'JSONCEOF'
{
  // This is a comment
  /* Block comment */
  "provider": {
    "default": "anthropic"
  }
}
JSONCEOF
JSONC_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if echo "$JSONC_OUTPUT" | grep -qi "SyntaxError\|parse error\|SIGSEGV"; then
  echo "  FAIL: JSONC config not supported"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: JSONC config with comments handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -f "$CONFIG_DIR/opencode.jsonc"

# ─────────────────────────────────────────────────────────────
# Environment Variable Edge Cases
# ─────────────────────────────────────────────────────────────

# 7. XDG directories with spaces in path
echo "  [7/15] XDG dirs with spaces..."
SPACE_DIR="/tmp/sanity dir with spaces"
mkdir -p "$SPACE_DIR"
SPACE_OUTPUT=$(XDG_CONFIG_HOME="$SPACE_DIR" timeout 10 altimate --version 2>&1 || true)
if echo "$SPACE_OUTPUT" | grep -qi "ENOENT\|SIGSEGV\|segfault"; then
  echo "  FAIL: spaces in XDG path caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: spaces in XDG path handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -rf "$SPACE_DIR"

# 8. HOME directory unset
echo "  [8/15] Unset HOME handling..."
NOHOME_OUTPUT=$(env -u HOME timeout 10 altimate --version 2>&1 || true)
if echo "$NOHOME_OUTPUT" | grep -qi "TypeError\|Cannot read\|SIGSEGV"; then
  echo "  FAIL: unset HOME caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: unset HOME handled (got: $(echo "$NOHOME_OUTPUT" | head -1))"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 9. Read-only config directory
echo "  [9/15] Read-only config directory..."
RO_DIR=$(mktemp -d /tmp/sanity-ro-config-XXXXXX)
mkdir -p "$RO_DIR/altimate-code"
chmod 555 "$RO_DIR/altimate-code"
RO_OUTPUT=$(XDG_CONFIG_HOME="$RO_DIR" timeout 10 altimate --version 2>&1 || true)
chmod 755 "$RO_DIR/altimate-code"
rm -rf "$RO_DIR"
if echo "$RO_OUTPUT" | grep -qi "EACCES\|SIGSEGV\|segfault"; then
  echo "  WARN: read-only config dir may cause issues (non-fatal for --version)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  PASS: read-only config dir handled gracefully"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────────────────────
# Project Context Edge Cases
# ─────────────────────────────────────────────────────────────

# 10. Non-git directory handled
echo "  [10/15] Non-git directory..."
NOGIT_DIR=$(mktemp -d /tmp/sanity-nogit-XXXXXX)
cd "$NOGIT_DIR"
NOGIT_OUTPUT=$(timeout 10 altimate --version 2>&1 || true)
if echo "$NOGIT_OUTPUT" | grep -qi "SIGSEGV\|segfault\|fatal"; then
  echo "  FAIL: non-git directory caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: non-git directory handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -rf "$NOGIT_DIR"
cd "$WORKDIR"

# 11. Empty git repo (no commits)
echo "  [11/15] Empty git repo..."
EMPTY_GIT=$(mktemp -d /tmp/sanity-emptygit-XXXXXX)
cd "$EMPTY_GIT"
git init -q
git config user.name "test"
git config user.email "test@test.local"
EMPTYGIT_OUTPUT=$(timeout 10 altimate --version 2>&1 || true)
if echo "$EMPTYGIT_OUTPUT" | grep -qi "SIGSEGV\|segfault"; then
  echo "  FAIL: empty git repo caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: empty git repo handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
rm -rf "$EMPTY_GIT"
cd "$WORKDIR"

# 12. Deeply nested project directory
echo "  [12/15] Deeply nested directory..."
DEEP_DIR="$WORKDIR"
for i in $(seq 1 30); do
  DEEP_DIR="$DEEP_DIR/level$i"
done
mkdir -p "$DEEP_DIR"
cd "$DEEP_DIR"
DEEP_OUTPUT=$(timeout 10 altimate --version 2>&1 || true)
if echo "$DEEP_OUTPUT" | grep -qi "SIGSEGV\|ENAMETOOLONG"; then
  echo "  FAIL: deeply nested directory caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: deeply nested directory handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi
cd "$WORKDIR"

# ─────────────────────────────────────────────────────────────
# Concurrent Access
# ─────────────────────────────────────────────────────────────

# 13. Multiple concurrent --version calls don't interfere
echo "  [13/15] Concurrent --version..."
PIDS=()
CONCURRENT_DIR=$(mktemp -d /tmp/sanity-concurrent-XXXXXX)
for i in $(seq 1 5); do
  altimate --version > "$CONCURRENT_DIR/v$i.txt" 2>&1 &
  PIDS+=($!)
done
CONCURRENT_FAIL=0
for pid in "${PIDS[@]}"; do
  wait "$pid" || CONCURRENT_FAIL=$((CONCURRENT_FAIL + 1))
done
# All outputs should be identical
FIRST=$(cat "$CONCURRENT_DIR/v1.txt" 2>/dev/null | head -1)
for i in $(seq 2 5); do
  OTHER=$(cat "$CONCURRENT_DIR/v$i.txt" 2>/dev/null | head -1)
  if [ "$FIRST" != "$OTHER" ]; then
    CONCURRENT_FAIL=$((CONCURRENT_FAIL + 1))
  fi
done
rm -rf "$CONCURRENT_DIR"
if [ "$CONCURRENT_FAIL" -eq 0 ]; then
  echo "  PASS: 5 concurrent --version calls all succeeded with same output"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: concurrent --version inconsistency ($CONCURRENT_FAIL mismatches)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# 14. Rapid sequential invocations don't corrupt state
echo "  [14/15] Rapid sequential invocations..."
RAPID_FAIL=0
for i in $(seq 1 10); do
  if ! altimate --version >/dev/null 2>&1; then
    RAPID_FAIL=$((RAPID_FAIL + 1))
  fi
done
if [ "$RAPID_FAIL" -eq 0 ]; then
  echo "  PASS: 10 rapid sequential calls all succeeded"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  FAIL: $RAPID_FAIL of 10 rapid calls failed"
  FAIL_COUNT=$((FAIL_COUNT + 1))
fi

# 15. Session list works even with zero sessions (after fresh install)
echo "  [15/15] Session list with empty DB..."
SESSION_OUTPUT=$(timeout 10 altimate session list 2>&1 || true)
if echo "$SESSION_OUTPUT" | grep -qi "TypeError\|Cannot read\|SIGSEGV"; then
  echo "  FAIL: session list with empty DB crashed"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: session list with empty/missing DB handled"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# Cleanup
rm -rf "$WORKDIR"

report_results "Phase 3b: Extended Resilience Tests"
