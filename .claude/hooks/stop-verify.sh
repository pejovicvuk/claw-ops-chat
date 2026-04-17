#!/usr/bin/env bash
# Stop hook: run tests and lint as final verification

echo "--- Final verification ---"

echo "[1/2] Running lint..."
npx eslint . 2>&1 | tail -20
LINT_EXIT=${PIPESTATUS[0]}

echo "[2/2] Running tests..."
npx vitest run 2>&1 | tail -30
TEST_EXIT=${PIPESTATUS[0]}

if [ "$LINT_EXIT" -ne 0 ] || [ "$TEST_EXIT" -ne 0 ]; then
  echo "VERIFICATION FAILED: lint=$LINT_EXIT test=$TEST_EXIT"
  echo "Please fix issues before considering this task complete."
  exit 1
fi

echo "All checks passed."
exit 0
