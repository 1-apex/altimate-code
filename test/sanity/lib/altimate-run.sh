#!/bin/bash
# Wrapper for altimate run with standard flags for sanity testing
#
# Usage: altimate_run <test-name> [altimate run args...]
# Output goes to /tmp/sanity-<test-name>.json
# Returns the exit code of altimate run

SANITY_TIMEOUT="${SANITY_TIMEOUT:-60}"

altimate_run() {
  local name="$1"; shift
  local outfile="/tmp/sanity-${name}.json"

  # Check if --format json is supported (confirmed in run.ts:292-296)
  timeout "$SANITY_TIMEOUT" altimate run --max-turns 2 --yolo --format json "$@" \
    > "$outfile" 2>&1
  local exit_code=$?

  # If timeout killed it
  if [ $exit_code -eq 124 ]; then
    echo "TIMEOUT" > "$outfile"
  fi

  return $exit_code
}

altimate_run_with_turns() {
  local name="$1"
  local turns="$2"
  shift 2
  local outfile="/tmp/sanity-${name}.json"

  timeout "$SANITY_TIMEOUT" altimate run --max-turns "$turns" --yolo --format json "$@" \
    > "$outfile" 2>&1
  local exit_code=$?

  if [ $exit_code -eq 124 ]; then
    echo "TIMEOUT" > "$outfile"
  fi

  return $exit_code
}

# Check if output file has content (not empty or just TIMEOUT)
has_output() {
  local name="$1"
  local outfile="/tmp/sanity-${name}.json"
  [ -f "$outfile" ] && [ -s "$outfile" ] && ! grep -q "^TIMEOUT$" "$outfile"
}

# Read output file
get_output() {
  local name="$1"
  cat "/tmp/sanity-${name}.json" 2>/dev/null || echo ""
}
