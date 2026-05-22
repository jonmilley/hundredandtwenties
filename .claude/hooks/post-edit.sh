#!/usr/bin/env bash
# PostToolUse hook (Edit|Write).
# 1. Typechecks the whole project whenever any .ts file changes (strict mode +
#    noUnusedLocals means a stray import breaks the build).
# 2. Runs the matching rule test when one of the rule modules changes, keeping
#    rules and tests in lockstep (see CLAUDE.md).
# On failure it exits 2 so the output is fed back to Claude to self-correct.
set -uo pipefail

input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

status=0

case "$file" in
  *.ts)
    if ! out=$(npx tsc --noEmit 2>&1); then
      echo "tsc --noEmit failed:" >&2
      echo "$out" >&2
      status=2
    fi
    ;;
esac

case "$file" in
  *src/game/bidding.ts) test_file=test/bidding.test.ts ;;
  *src/game/play.ts)    test_file=test/play.test.ts ;;
  *src/game/ranking.ts) test_file=test/ranking.test.ts ;;
  *)                    test_file="" ;;
esac

if [ -n "$test_file" ]; then
  if ! out=$(npx vitest run "$test_file" 2>&1); then
    echo "$test_file failed:" >&2
    echo "$out" >&2
    status=2
  fi
fi

exit $status
