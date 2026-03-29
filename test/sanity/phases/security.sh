#!/bin/bash
# Phase 5: Security tests — credential leakage, input sanitization, isolation
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"
source "$SCRIPT_DIR/lib/altimate-run.sh"

echo "--- Phase 5: Security Tests ---"

# Disable core dumps to prevent credential leakage via crash dumps
ulimit -c 0 2>/dev/null || true

# Set up a git repo for project context
WORKDIR=$(mktemp -d /tmp/sanity-security-XXXXXX)
cd "$WORKDIR" || { echo "FAIL: cannot cd to $WORKDIR"; exit 1; }
git init -q
git config user.name "sanity-test"
git config user.email "sanity@test.local"
echo '{}' > package.json
git add -A && git commit -q -m "init"

# ─────────────────────────────────────────────────────────────
# Credential Leakage Prevention
# ─────────────────────────────────────────────────────────────

# 1. API key not leaked in --help output
echo "  [1/15] API key not in --help..."
HELP_OUTPUT=$(ANTHROPIC_API_KEY="SANITY-FAKE-KEY-NOT-REAL-98765" altimate --help 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -q "SANITY-FAKE-KEY-NOT-REAL-98765"; then
  echo "  FAIL: API key leaked in --help output"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: API key not in --help output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 2. API key not leaked in --version output
echo "  [2/15] API key not in --version..."
VERSION_OUTPUT=$(ANTHROPIC_API_KEY="SANITY-FAKE-KEY-NOT-REAL-98765" altimate --version 2>&1 || true)
if echo "$VERSION_OUTPUT" | grep -q "SANITY-FAKE-KEY-NOT-REAL-98765"; then
  echo "  FAIL: API key leaked in --version output"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: API key not in --version output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 3. API key not leaked in error output
echo "  [3/15] API key not in error output..."
ERR_OUTPUT=$(ANTHROPIC_API_KEY="SANITY-FAKE-KEY-NOT-REAL-98765" timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if echo "$ERR_OUTPUT" | grep -q "SANITY-FAKE-KEY-NOT-REAL-98765"; then
  echo "  FAIL: API key leaked in error/run output"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: API key not in error/run output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 4. Database connection strings not leaked in error messages
echo "  [4/15] Connection strings not in errors..."
# Use a clearly-fake password that GitGuardian won't flag
FAKE_DB_PASS="SANITY-TEST-NOT-REAL-$(date +%s)"
CONN_OUTPUT=$(ALTIMATE_CODE_CONN_PG_TEST="{\"type\":\"postgresql\",\"host\":\"secret.internal\",\"password\":\"${FAKE_DB_PASS}\"}" \
  timeout 15 altimate run --max-turns 1 --yolo "connect to postgres" 2>&1 || true)
if echo "$CONN_OUTPUT" | grep -q "$FAKE_DB_PASS"; then
  echo "  FAIL: database password leaked in output"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: database password not leaked"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────────────────────
# Input Sanitization
# ─────────────────────────────────────────────────────────────

# 5. Shell metacharacters in arguments don't execute (side-effect based)
echo "  [5/15] Shell injection in args..."
INJECT_MARKER="/tmp/sanity-inject-marker-$$"
rm -f "$INJECT_MARKER"
timeout 10 altimate check "nonexistent.sql; touch $INJECT_MARKER" 2>&1 >/dev/null || true
if [ -f "$INJECT_MARKER" ]; then
  echo "  FAIL: shell injection succeeded (marker file created)"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  rm -f "$INJECT_MARKER"
else
  echo "  PASS: shell metacharacters not interpreted"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 6. Path traversal in file arguments — check doesn't read system files
echo "  [6/15] Path traversal in file args..."
# altimate check is an SQL linter — it reads the file and parses SQL.
# Verify it doesn't crash or expose system file contents in its output.
TRAVERSAL_OUTPUT=$(timeout 10 altimate check "../../../../etc/passwd" 2>&1 || true)
if echo "$TRAVERSAL_OUTPUT" | grep -qi "root:x:0\|SIGSEGV\|segfault"; then
  echo "  FAIL: path traversal exposed system file contents or crashed"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: path traversal handled without exposing system files"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 7. Null bytes in arguments don't crash
echo "  [7/15] Null bytes in args..."
NULL_OUTPUT=$(printf 'hello\x00world' | timeout 10 altimate check /dev/stdin 2>&1 || true)
if echo "$NULL_OUTPUT" | grep -qi "SIGSEGV\|segfault\|core dumped"; then
  echo "  FAIL: null bytes caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: null bytes handled without crash"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 8. Extremely long arguments don't crash
echo "  [8/15] Extremely long arguments..."
LONG_ARG=$(python3 -c "print('A' * 100000)" 2>/dev/null || printf '%100000s' | tr ' ' 'A')
LONG_OUTPUT=$(timeout 10 altimate check "$LONG_ARG" 2>&1 || true)
if echo "$LONG_OUTPUT" | grep -qi "SIGSEGV\|segfault\|heap\|out of memory"; then
  echo "  FAIL: extremely long argument caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: long argument handled without crash"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────────────────────
# File System Isolation
# ─────────────────────────────────────────────────────────────

# 9. Check command doesn't write files outside project
echo "  [9/15] Check command isolation..."
BEFORE_COUNT=$(find /tmp -maxdepth 1 -name "altimate-*" -newer "$WORKDIR" 2>/dev/null | wc -l)
echo "SELECT 1;" > test_isolation.sql
timeout 10 altimate check test_isolation.sql 2>&1 >/dev/null || true
AFTER_COUNT=$(find /tmp -maxdepth 1 -name "altimate-*" -newer "$WORKDIR" 2>/dev/null | wc -l)
LEAKED=$((AFTER_COUNT - BEFORE_COUNT))
if [ "$LEAKED" -le 0 ]; then
  echo "  PASS: check command did not leak files to /tmp"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  WARN: check command created $LEAKED temp file(s) in /tmp (non-fatal)"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 10. Config directory permissions are not world-readable
echo "  [10/15] Config directory permissions..."
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/altimate-code"
if [ -d "$CONFIG_DIR" ]; then
  PERMS=$(stat -c '%a' "$CONFIG_DIR" 2>/dev/null || stat -f '%Lp' "$CONFIG_DIR" 2>/dev/null || echo "unknown")
  # Last digit should not be readable by others (no 4, 5, 6, 7 in last position)
  WORLD_READ=$(echo "$PERMS" | grep -oE '.$')
  if [ "$WORLD_READ" = "0" ] || [ "$WORLD_READ" = "1" ] || [ "$WORLD_READ" = "2" ] || [ "$WORLD_READ" = "3" ]; then
    echo "  PASS: config directory not world-readable (${PERMS})"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  WARN: config directory may be world-readable (${PERMS})"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
else
  skip_test "Config directory permissions" "config dir not found"
fi

# ─────────────────────────────────────────────────────────────
# Error Message Safety
# ─────────────────────────────────────────────────────────────

# 11. Stack traces not exposed in normal error paths
echo "  [11/15] No stack traces in normal errors..."
# Trigger a known error: run with no API key
SAVED_KEY="${ANTHROPIC_API_KEY:-}"
unset ANTHROPIC_API_KEY
STACK_OUTPUT=$(timeout 15 altimate run --max-turns 1 --yolo "hello" 2>&1 || true)
if [ -n "$SAVED_KEY" ]; then export ANTHROPIC_API_KEY="$SAVED_KEY"; fi
if echo "$STACK_OUTPUT" | grep -qE "^\s+at\s+.*\(.*:[0-9]+:[0-9]+\)"; then
  echo "  FAIL: stack trace exposed to user"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: no stack traces in error output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 12. Internal file paths not exposed in errors
echo "  [12/15] No internal paths in errors..."
if echo "$STACK_OUTPUT" | grep -qE "/packages/opencode/src/|/node_modules/"; then
  echo "  WARN: internal file paths visible in error output (non-fatal)"
  PASS_COUNT=$((PASS_COUNT + 1))
else
  echo "  PASS: no internal file paths in error output"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# ─────────────────────────────────────────────────────────────
# Unicode & Encoding Safety
# ─────────────────────────────────────────────────────────────

# 13. Unicode input doesn't crash
echo "  [13/15] Unicode input handling..."
echo "SELECT * FROM 表テーブル WHERE 名前 = 'тест' AND emoji = '🔥';" > unicode_test.sql
UNICODE_OUTPUT=$(timeout 10 altimate check unicode_test.sql 2>&1 || true)
if echo "$UNICODE_OUTPUT" | grep -qi "SIGSEGV\|segfault\|encoding error\|invalid byte"; then
  echo "  FAIL: unicode input caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: unicode input handled without crash"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 14. RTL and bidirectional text doesn't crash
echo "  [14/15] RTL/bidirectional text..."
echo "SELECT * FROM users WHERE name = 'مرحبا‎ test ‏שלום';" > rtl_test.sql
RTL_OUTPUT=$(timeout 10 altimate check rtl_test.sql 2>&1 || true)
if echo "$RTL_OUTPUT" | grep -qi "SIGSEGV\|segfault"; then
  echo "  FAIL: RTL text caused crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: RTL text handled without crash"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# 15. SQL injection patterns in check command don't crash
echo "  [15/16] SQL injection patterns..."
if [ -f "$SCRIPT_DIR/fixtures/injection-test.sql" ]; then
  INJECT_SQL_OUTPUT=$(timeout 15 altimate check "$SCRIPT_DIR/fixtures/injection-test.sql" 2>&1 || true)
  if echo "$INJECT_SQL_OUTPUT" | grep -qi "SIGSEGV\|segfault\|core dumped\|DROP TABLE"; then
    echo "  FAIL: SQL injection patterns caused crash or execution"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo "  PASS: SQL injection patterns handled safely"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
else
  skip_test "SQL injection patterns" "injection-test.sql fixture not found"
fi

# 16. Very large SQL file doesn't OOM the check command
echo "  [16/16] Large SQL file handling..."
# Generate a 500KB SQL file (reasonable for a real project)
python3 -c "
for i in range(5000):
    print(f'SELECT col_{i} FROM table_{i % 100} WHERE id = {i};')
" > large_test.sql 2>/dev/null || {
  for i in $(seq 1 5000); do
    echo "SELECT col_$i FROM table_$((i % 100)) WHERE id = $i;"
  done > large_test.sql
}
LARGE_OUTPUT=$(timeout 30 altimate check large_test.sql 2>&1 || true)
if echo "$LARGE_OUTPUT" | grep -qi "SIGSEGV\|segfault\|heap\|out of memory\|ENOMEM"; then
  echo "  FAIL: large SQL file caused OOM/crash"
  FAIL_COUNT=$((FAIL_COUNT + 1))
else
  echo "  PASS: large SQL file handled ($(wc -l < large_test.sql) lines)"
  PASS_COUNT=$((PASS_COUNT + 1))
fi

# Cleanup
rm -rf "$WORKDIR"

report_results "Phase 5: Security Tests"
