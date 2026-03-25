#!/bin/bash
# Assertion helpers for sanity tests

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

assert_exit_0() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc (exit code $?)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_exit_nonzero() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "  FAIL: $desc (expected non-zero exit, got 0)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

assert_contains() {
  local actual="$1"
  local expected="$2"
  local desc="$3"
  if echo "$actual" | grep -qi "$expected"; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc (output does not contain '$expected')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_not_contains() {
  local actual="$1"
  local expected="$2"
  local desc="$3"
  if echo "$actual" | grep -qi "$expected"; then
    echo "  FAIL: $desc (output unexpectedly contains '$expected')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  else
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  fi
}

assert_file_exists() {
  local path="$1"
  local desc="$2"
  if [ -f "$path" ]; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc ($path not found)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_dir_exists() {
  local path="$1"
  local desc="$2"
  if [ -d "$path" ]; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc ($path not found)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_ge() {
  local actual="$1"
  local expected="$2"
  local desc="$3"
  if [ "$actual" -ge "$expected" ] 2>/dev/null; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc (got $actual, expected >= $expected)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local desc="$3"
  if [ "$actual" = "$expected" ]; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc (got '$actual', expected '$expected')"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_neq() {
  local actual="$1"
  local expected="$2"
  local desc="$3"
  if [ "$actual" != "$expected" ]; then
    echo "  PASS: $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $desc (got '$actual', expected different)"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

skip_test() {
  local desc="$1"
  local reason="$2"
  echo "  SKIP: $desc ($reason)"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

report_results() {
  local phase="$1"
  echo ""
  echo "=== $phase: $PASS_COUNT passed, $FAIL_COUNT failed, $SKIP_COUNT skipped ==="
  if [ "$FAIL_COUNT" -gt 0 ]; then
    return 1
  fi
  return 0
}
