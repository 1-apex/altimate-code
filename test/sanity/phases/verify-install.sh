#!/bin/bash
# Phase 1: Verify that npm install -g produced a working installation
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$SCRIPT_DIR/lib/assert.sh"

echo "--- Phase 1: Verify Installation ---"

# 1. Binary linked correctly
assert_exit_0 "altimate binary available" altimate --version

# 2. Version is non-empty and looks like a version string
VERSION=$(altimate --version 2>/dev/null || echo "")
assert_contains "$VERSION" "." "version contains dot separator"

# 3. Builtin skills copied by postinstall
SKILL_COUNT=$(find ~/.altimate/builtin -name "SKILL.md" -maxdepth 2 2>/dev/null | wc -l)
SKILL_COUNT="${SKILL_COUNT:-0}"
assert_ge "$SKILL_COUNT" 17 "builtin skills installed (got $SKILL_COUNT)"

# 4. Critical skill: data-viz
assert_file_exists "$HOME/.altimate/builtin/data-viz/SKILL.md" "data-viz skill exists"

# 5. Critical skill: sql-review
assert_file_exists "$HOME/.altimate/builtin/sql-review/SKILL.md" "sql-review skill exists"

# 6. Critical skill: dbt-analyze
assert_file_exists "$HOME/.altimate/builtin/dbt-analyze/SKILL.md" "dbt-analyze skill exists"

# 7. altimate-core napi binding loads
assert_exit_0 "altimate-core napi binding" node -e "require('@altimateai/altimate-core')"

# 8. dbt CLI available
if command -v dbt >/dev/null 2>&1; then
  assert_exit_0 "dbt CLI available" dbt --version
else
  skip_test "dbt CLI available" "dbt not installed in this environment"
fi

# 9. git available (needed for project detection)
assert_exit_0 "git CLI available" git --version

report_results "Phase 1: Verify Installation"
