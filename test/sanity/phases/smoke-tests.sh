#!/bin/bash
# Phase 2: E2E smoke tests via altimate run (parallelized)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"
source "$SCRIPT_DIR/lib/altimate-run.sh"
source "$SCRIPT_DIR/lib/parallel.sh"

echo "--- Phase 2: Smoke Tests ---"

# Need an API key for LLM-dependent tests
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "  WARNING: ANTHROPIC_API_KEY not set — skipping LLM-dependent smoke tests"
  skip_test "all smoke tests" "no ANTHROPIC_API_KEY"
  report_results "Phase 2: Smoke Tests"
  exit $?
fi

# Detect parallelism
MAX_PARALLEL=$(detect_parallelism)
echo "  Parallelism: $MAX_PARALLEL concurrent tests ($(nproc 2>/dev/null || echo '?') cores, $(free -g 2>/dev/null | grep Mem | awk '{print $2}' || echo '?')GB RAM)"

# Initialize a git repo in a temp dir so altimate has a project context
WORKDIR=$(mktemp -d /tmp/sanity-workdir-XXXXXX)
cd "$WORKDIR" || { echo "FAIL: cannot cd to $WORKDIR"; exit 1; }
git init -q
git config user.name "sanity-test"
git config user.email "sanity@test.local"
echo '{}' > package.json
git add -A && git commit -q -m "init"

# Each test writes its result to a file: PASS, FAIL, or SKIP
RESULTS_DIR=$(mktemp -d /tmp/sanity-results-XXXXXX)

# Define all test functions
test_discover_mcps() {
  cd "$WORKDIR"
  altimate_run "discover-mcps" --command discover-and-add-mcps "list"
  local output=$(get_output "discover-mcps")
  if echo "$output" | grep -qi "command not found\|Unknown command"; then
    echo "FAIL" > "$RESULTS_DIR/discover-mcps"
  else
    echo "PASS" > "$RESULTS_DIR/discover-mcps"
  fi
}

test_configure_claude() {
  cd "$WORKDIR" || return 1
  altimate_run "configure-claude" --command configure-claude "check"
  local output=$(get_output "configure-claude")
  if echo "$output" | grep -qi "TIMEOUT\|command not found\|Unknown command"; then
    echo "FAIL" > "$RESULTS_DIR/configure-claude"
  else
    echo "PASS" > "$RESULTS_DIR/configure-claude"
  fi
}

test_sql_analyze() {
  cd "$WORKDIR"
  altimate_run "sql-analyze" -f "$SCRIPT_DIR/fixtures/test.sql" "analyze this SQL for anti-patterns"
  local output=$(get_output "sql-analyze")
  if echo "$output" | grep -q "TIMEOUT"; then
    echo "FAIL" > "$RESULTS_DIR/sql-analyze"
  else
    echo "PASS" > "$RESULTS_DIR/sql-analyze"
  fi
}

test_duckdb() {
  cd "$WORKDIR"
  altimate_run "duckdb" "run the query SELECT 1 using duckdb"
  local output=$(get_output "duckdb")
  if echo "$output" | grep -q "TIMEOUT"; then
    echo "FAIL" > "$RESULTS_DIR/duckdb"
  else
    echo "PASS" > "$RESULTS_DIR/duckdb"
  fi
}

test_postgres() {
  # Use env vars if set (Docker compose), else probe local Docker port
  local pg_host="${TEST_PG_HOST:-}"
  local pg_port="${TEST_PG_PORT:-5432}"
  if [ -z "$pg_host" ]; then
    if timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/15432" 2>/dev/null; then
      pg_host="127.0.0.1"; pg_port="15432"
    else
      echo "SKIP" > "$RESULTS_DIR/postgres"
      return
    fi
  fi
  cd "$WORKDIR" || return 1
  # Export explicit connection config so the CLI doesn't guess the user
  local pg_user="${TEST_PG_USER:-postgres}"
  local pg_pass="${TEST_PG_PASSWORD:-testpass123}"
  export ALTIMATE_CODE_CONN_PG_TEST="{\"type\":\"postgres\",\"host\":\"${pg_host}\",\"port\":${pg_port},\"user\":\"${pg_user}\",\"password\":\"${pg_pass}\",\"database\":\"postgres\"}"
  altimate_run "postgres" "run SELECT 1 against postgres at ${pg_host}:${pg_port}"
  local output=$(get_output "postgres")
  if echo "$output" | grep -qi "TIMEOUT\|unhandled"; then
    echo "FAIL" > "$RESULTS_DIR/postgres"
  else
    echo "PASS" > "$RESULTS_DIR/postgres"
  fi
}

test_snowflake() {
  # Snowflake requires real cloud credentials — cannot be Docker'd.
  # Accepts either ALTIMATE_CODE_CONN_SNOWFLAKE_TEST (JSON config) or
  # individual SNOWFLAKE_ACCOUNT/USER/PASSWORD env vars.
  if [ -z "${ALTIMATE_CODE_CONN_SNOWFLAKE_TEST:-}" ]; then
    if [ -n "${SNOWFLAKE_ACCOUNT:-}" ] && [ -n "${SNOWFLAKE_USER:-}" ] && [ -n "${SNOWFLAKE_PASSWORD:-}" ]; then
      export ALTIMATE_CODE_CONN_SNOWFLAKE_TEST=$(cat <<SFEOF
{"type":"snowflake","account":"${SNOWFLAKE_ACCOUNT}","user":"${SNOWFLAKE_USER}","password":"${SNOWFLAKE_PASSWORD}","warehouse":"${SNOWFLAKE_WAREHOUSE:-COMPUTE_WH}","role":"${SNOWFLAKE_ROLE:-PUBLIC}"}
SFEOF
      )
    else
      echo "SKIP" > "$RESULTS_DIR/snowflake"
      return
    fi
  fi
  cd "$WORKDIR" || return 1
  altimate_run "snowflake" "run SELECT 1 against snowflake"
  local output=$(get_output "snowflake")
  if echo "$output" | grep -qi "TIMEOUT\|unhandled"; then
    echo "FAIL" > "$RESULTS_DIR/snowflake"
  else
    echo "PASS" > "$RESULTS_DIR/snowflake"
  fi
}

test_mongodb() {
  # Use env vars if set (Docker compose), else probe local Docker port
  local mongo_host="${TEST_MONGODB_HOST:-}"
  local mongo_port="${TEST_MONGODB_PORT:-27017}"
  if [ -z "$mongo_host" ]; then
    if timeout 2 bash -c "echo >/dev/tcp/127.0.0.1/17017" 2>/dev/null; then
      mongo_host="127.0.0.1"; mongo_port="17017"
    else
      echo "SKIP" > "$RESULTS_DIR/mongodb"
      return
    fi
  fi
  cd "$WORKDIR" || return 1
  altimate_run "mongodb" "run a find command on the admin database against mongodb at ${mongo_host}:${mongo_port}"
  local output=$(get_output "mongodb")
  if echo "$output" | grep -qi "TIMEOUT\|unhandled\|driver not installed"; then
    echo "FAIL" > "$RESULTS_DIR/mongodb"
  else
    echo "PASS" > "$RESULTS_DIR/mongodb"
  fi
}

test_builder() {
  cd "$WORKDIR"
  altimate_run "builder" --agent builder "say hello"
  local output=$(get_output "builder")
  if echo "$output" | grep -q "TIMEOUT"; then
    echo "FAIL" > "$RESULTS_DIR/builder"
  else
    echo "PASS" > "$RESULTS_DIR/builder"
  fi
}

test_analyst() {
  cd "$WORKDIR"
  altimate_run "analyst" --agent analyst "say hello"
  local output=$(get_output "analyst")
  if echo "$output" | grep -q "TIMEOUT"; then
    echo "FAIL" > "$RESULTS_DIR/analyst"
  else
    echo "PASS" > "$RESULTS_DIR/analyst"
  fi
}

test_bad_command() {
  cd "$WORKDIR"
  altimate_run_with_turns "bad-cmd" 1 --command nonexistent-cmd-xyz "test" || true
  local output=$(get_output "bad-cmd")
  if echo "$output" | grep -qi "unhandled"; then
    echo "FAIL" > "$RESULTS_DIR/bad-cmd"
  else
    echo "PASS" > "$RESULTS_DIR/bad-cmd"
  fi
}

test_discover() {
  cd "$WORKDIR"
  SANITY_TIMEOUT=120 altimate_run_with_turns "discover" 3 --command discover "scan this project" || true
  local output=$(get_output "discover")
  if echo "$output" | grep -qi "unhandled"; then
    echo "FAIL" > "$RESULTS_DIR/discover"
  else
    echo "PASS" > "$RESULTS_DIR/discover"
  fi
}

test_dbt_discover() {
  # Use isolated workdir to avoid race conditions with parallel tests (#448, #270)
  local dbt_dir=$(mktemp -d /tmp/sanity-dbt-XXXXXX)
  cd "$dbt_dir"
  git init -q
  git config user.name "sanity-test"
  git config user.email "sanity@test.local"
  echo '{}' > package.json
  mkdir -p models
  cat > dbt_project.yml <<'DBTEOF'
name: sanity_test
version: '1.0.0'
config-version: 2
profile: sanity_test
DBTEOF
  cat > models/test_model.sql <<'SQLEOF'
SELECT 1 AS id
SQLEOF
  git add -A && git commit -q -m "add dbt project"
  SANITY_TIMEOUT=90 altimate_run_with_turns "dbt-discover" 2 "discover dbt project config in this repo" || true
  local output=$(get_output "dbt-discover")
  if echo "$output" | grep -qi "unhandled\|TypeError\|Cannot read"; then
    echo "FAIL" > "$RESULTS_DIR/dbt-discover"
  else
    echo "PASS" > "$RESULTS_DIR/dbt-discover"
  fi
  rm -rf "$dbt_dir"
}

test_check_command() {
  cd "$WORKDIR"
  # altimate-code check should run deterministic SQL checks without LLM (#453)
  echo "SELECT * FROM users WHERE 1=1;" > check_target.sql
  local output=$(timeout 30 altimate check check_target.sql 2>&1 || true)
  if echo "$output" | grep -qi "TypeError\|unhandled\|Cannot read properties"; then
    echo "FAIL" > "$RESULTS_DIR/check-cmd"
  else
    echo "PASS" > "$RESULTS_DIR/check-cmd"
  fi
}

# Run tests in parallel batches
echo ""
echo "  Running $MAX_PARALLEL tests concurrently..."

PIDS=()
TESTS=(
  "test_discover_mcps"
  "test_configure_claude"
  "test_sql_analyze"
  "test_duckdb"
  "test_postgres"
  "test_snowflake"
  "test_mongodb"
  "test_builder"
  "test_analyst"
  "test_bad_command"
  "test_discover"
  "test_dbt_discover"
  "test_check_command"
)

TEST_NAMES=(
  "discover-mcps"
  "configure-claude"
  "sql-analyze"
  "duckdb"
  "postgres"
  "snowflake"
  "mongodb"
  "builder"
  "analyst"
  "bad-cmd"
  "discover"
  "dbt-discover"
  "check-cmd"
)

# Launch in batches of MAX_PARALLEL
idx=0
while [ $idx -lt ${#TESTS[@]} ]; do
  PIDS=()
  batch_end=$((idx + MAX_PARALLEL))
  if [ $batch_end -gt ${#TESTS[@]} ]; then
    batch_end=${#TESTS[@]}
  fi

  # Launch batch
  for ((i=idx; i<batch_end; i++)); do
    ${TESTS[$i]} &
    PIDS+=($!)
  done

  # Wait for batch
  for pid in "${PIDS[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  idx=$batch_end
done

# Collect results
echo ""
echo "  Results:"
for name in "${TEST_NAMES[@]}"; do
  result=$(cat "$RESULTS_DIR/$name" 2>/dev/null || echo "MISSING")
  case "$result" in
    PASS)
      echo "  PASS: $name"
      PASS_COUNT=$((PASS_COUNT + 1))
      ;;
    FAIL)
      echo "  FAIL: $name"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      ;;
    SKIP)
      echo "  SKIP: $name"
      SKIP_COUNT=$((SKIP_COUNT + 1))
      ;;
    *)
      echo "  FAIL: $name (no result file)"
      FAIL_COUNT=$((FAIL_COUNT + 1))
      ;;
  esac
done

# Cleanup
rm -rf "$WORKDIR" "$RESULTS_DIR"

report_results "Phase 2: Smoke Tests"
