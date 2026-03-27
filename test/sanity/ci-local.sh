#!/bin/bash
# Local CI pipeline — ports .github/workflows/ci.yml to run locally
set -euo pipefail

MODE="${1:-fast}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
EXIT_CODE=0

# Ensure Docker containers are cleaned up on exit (full/pr modes)
cleanup_docker() {
  docker compose -f "$REPO_ROOT/test/sanity/docker-compose.yml" down --volumes --remove-orphans 2>/dev/null || true
}
trap cleanup_docker EXIT

echo "========================================"
echo "  Local CI Pipeline — mode: $MODE"
echo "  Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "========================================"

run_step() {
  local name="$1"; shift
  echo ""
  echo "--- $name ---"
  if "$@"; then
    echo "  >>> $name: PASSED"
  else
    echo "  >>> $name: FAILED"
    EXIT_CODE=1
  fi
}

# ── Fast mode (default — what pre-push hook runs) ──────────────

echo ""
echo "=== Fast CI ==="

run_step "Typecheck" bun turbo typecheck

run_step "Unit Tests (opencode)" bash -c "cd $REPO_ROOT/packages/opencode && bun test --timeout 30000"

run_step "Unit Tests (dbt-tools)" bash -c "cd $REPO_ROOT/packages/dbt-tools && bun run test"

# Marker guard (needs upstream remote)
if git remote | grep -q upstream; then
  run_step "Marker Guard" bun run "$REPO_ROOT/script/upstream/analyze.ts" --markers --base origin/main --strict
else
  echo ""
  echo "--- Marker Guard ---"
  echo "  SKIP: upstream remote not configured"
fi

# ── Full mode ──────────────────────────────────────────────────

if [ "$MODE" = "--full" ] || [ "$MODE" = "full" ]; then
  echo ""
  echo "=== Full CI (Docker) ==="

  # Driver E2E with Docker containers
  run_step "Docker Services Up" docker compose -f "$REPO_ROOT/test/sanity/docker-compose.yml" up -d postgres mysql mssql redshift mongodb

  echo "  Waiting for services to be healthy..."
  HEALTHY=0
  for _wait in $(seq 1 30); do
    HEALTHY=$(docker compose -f "$REPO_ROOT/test/sanity/docker-compose.yml" ps --format json 2>/dev/null | grep -c '"healthy"' || echo "0")
    if [ "$HEALTHY" -ge 5 ]; then break; fi
    sleep 2
  done

  if [ "$HEALTHY" -lt 5 ]; then
    echo "  >>> Docker Services: FAILED ($HEALTHY/5 healthy after 60s)"
    EXIT_CODE=1
  else
    echo "  >>> Docker Services: $HEALTHY/5 healthy"
  fi

  # Skip driver tests if services aren't healthy
  if [ "$HEALTHY" -lt 5 ]; then
    echo "  SKIP: Driver E2E tests (services not healthy)"
  else

  run_step "Driver E2E (local)" bash -c "cd $REPO_ROOT/packages/opencode && \
    TEST_PG_HOST=127.0.0.1 TEST_PG_PORT=15432 TEST_PG_PASSWORD=testpass123 \
    bun test test/altimate/drivers-e2e.test.ts --timeout 30000"

  run_step "Driver E2E (docker)" bash -c "cd $REPO_ROOT/packages/opencode && \
    TEST_MYSQL_HOST=127.0.0.1 TEST_MYSQL_PORT=13306 TEST_MYSQL_PASSWORD=testpass123 \
    TEST_MSSQL_HOST=127.0.0.1 TEST_MSSQL_PORT=11433 TEST_MSSQL_PASSWORD='TestPass123!' \
    TEST_REDSHIFT_HOST=127.0.0.1 TEST_REDSHIFT_PORT=15439 TEST_REDSHIFT_PASSWORD=testpass123 \
    bun test test/altimate/drivers-docker-e2e.test.ts --timeout 30000"

  run_step "Driver E2E (mongodb)" bash -c "cd $REPO_ROOT/packages/opencode && \
    TEST_MONGODB_HOST=127.0.0.1 TEST_MONGODB_PORT=17017 \
    bun test test/altimate/drivers-mongodb-e2e.test.ts --timeout 30000"

  # Full sanity suite in Docker
  run_step "Sanity Suite (Docker)" docker compose -f "$REPO_ROOT/test/sanity/docker-compose.yml" \
    up --build --abort-on-container-exit --exit-code-from sanity

  fi  # end healthy gate
fi

# ── PR mode ────────────────────────────────────────────────────

if [ "$MODE" = "--pr" ] || [ "$MODE" = "pr" ]; then
  echo ""
  echo "=== PR-Aware Tests ==="

  run_step "Generate PR tests" bash "$REPO_ROOT/test/sanity/pr-tests/generate.sh" origin/main
  run_step "Run PR tests" bash "$REPO_ROOT/test/sanity/pr-tests/run-pr-tests.sh"
fi

# ── Summary ────────────────────────────────────────────────────

echo ""
echo "========================================"
if [ $EXIT_CODE -eq 0 ]; then
  echo "  LOCAL CI: ALL PASSED"
else
  echo "  LOCAL CI: SOME STEPS FAILED"
fi
echo "========================================"

exit $EXIT_CODE
