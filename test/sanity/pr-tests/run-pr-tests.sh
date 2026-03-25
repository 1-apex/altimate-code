#!/bin/bash
# Execute PR-specific test manifest
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"
MANIFEST="/tmp/sanity-pr-manifest.txt"

echo "--- PR-Specific Tests ---"

if [ ! -f "$MANIFEST" ] || [ ! -s "$MANIFEST" ]; then
  echo "  No PR-specific tests to run."
  report_results "PR-Specific Tests"
  exit $?
fi

while IFS='|' read -r name cmd; do
  echo "  Running: $name"
  if eval "$cmd" >/dev/null 2>&1; then
    echo "  PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  FAIL: $name"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < "$MANIFEST"

report_results "PR-Specific Tests"
