#!/bin/bash
# Main entry point for sanity tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/lib/cleanup.sh"
MODE="${1:-fresh}"
EXIT_CODE=0

# Clean up temp files from previous runs
cleanup_sanity_outputs

echo "========================================"
echo "  altimate-code Sanity Test Suite"
echo "  Mode: $MODE"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"
echo ""

run_phase() {
  local script="$1"
  local name="$2"
  echo ""
  if bash "$script"; then
    echo "  >>> $name: PASSED"
  else
    echo "  >>> $name: FAILED"
    EXIT_CODE=1
  fi
  echo ""
}

# Phase 1: Always run install verification
run_phase "$SCRIPT_DIR/phases/verify-install.sh" "Verify Installation"

# Phase 1b: Extended install verification (packaging, permissions, bundling)
run_phase "$SCRIPT_DIR/phases/verify-install-extended.sh" "Extended Installation Verification"

# Phase 2: Smoke tests (needs ANTHROPIC_API_KEY)
run_phase "$SCRIPT_DIR/phases/smoke-tests.sh" "Smoke Tests"

# Phase 3: Resilience tests
run_phase "$SCRIPT_DIR/phases/resilience.sh" "Resilience Tests"

# Phase 3b: Extended resilience (recovery, concurrency, config edge cases)
run_phase "$SCRIPT_DIR/phases/resilience-extended.sh" "Extended Resilience Tests"

# Phase 4: Upgrade verification (only in upgrade mode)
if [ "$MODE" = "--upgrade" ]; then
  # Read old version from file set by Dockerfile.upgrade
  if [ -f "${OLD_VERSION_FILE:-}" ]; then
    export OLD_VERSION=$(cat "$OLD_VERSION_FILE")
  fi
  run_phase "$SCRIPT_DIR/phases/verify-upgrade.sh" "Upgrade Verification"
fi

# Phase 5: Security tests (credential leakage, input sanitization, isolation)
run_phase "$SCRIPT_DIR/phases/security.sh" "Security Tests"

echo "========================================"
if [ $EXIT_CODE -eq 0 ]; then
  echo "  ALL PHASES PASSED"
else
  echo "  SOME PHASES FAILED"
fi
echo "========================================"

exit $EXIT_CODE
