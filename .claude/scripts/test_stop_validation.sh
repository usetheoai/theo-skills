#!/bin/bash
# Behaviour suite for hooks/stop-validation.sh — the CHANGELOG hard gate.
#
# Drives real git state in a throwaway repository per scenario (no mocks, no
# shared state, order-independent). Each scenario asserts the hook's exit code:
#   0 — clean or advisory-only
#   2 — hard-gate violation
#
# Run: bash .claude/scripts/test_stop_validation.sh

set -uo pipefail

ECO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SRC="$ECO_DIR/hooks/stop-validation.sh"
LIB_SRC="$ECO_DIR/hooks/lib/detect-layout.sh"

PASSED=0
FAILED=0

# Builds an isolated repo whose LAST COMMIT touches exactly the given files.
# That is the real shape of the failure: the gate reads `git diff HEAD~1..HEAD`,
# so the scenario has to arrive through a commit, not the working tree.
#
#   make_repo <dir> <file>...
make_repo() {
  local repo="$1"; shift
  mkdir -p "$repo/.claude/skills" "$repo/.claude/rules" "$repo/.claude/hooks/lib"
  cp "$HOOK_SRC" "$repo/.claude/hooks/stop-validation.sh"
  cp "$LIB_SRC" "$repo/.claude/hooks/lib/detect-layout.sh"

  git -C "$repo" init -q
  git -C "$repo" config user.email t@t.t
  git -C "$repo" config user.name t

  # Baseline: every file in the scenario exists and is tracked, so the last
  # commit is a modification of known files rather than a mass addition.
  printf '# Changelog\n\n## [Unreleased]\n' > "$repo/CHANGELOG.md"
  printf '# Kit changelog\n\n## [Unreleased]\n' > "$repo/.claude/CHANGELOG.md"
  for f in "$@"; do
    mkdir -p "$repo/$(dirname "$f")"
    printf 'baseline\n' > "$repo/$f"
  done
  git -C "$repo" add -A >/dev/null
  git -C "$repo" commit -qm baseline

  # The commit under test.
  for f in "$@"; do
    printf 'changed\n' >> "$repo/$f"
  done
  git -C "$repo" add -A >/dev/null
  git -C "$repo" commit -qm "change"
}

#   scenario <expected_exit> <name> <file>...
scenario() {
  local expected="$1" name="$2"; shift 2
  local repo
  repo="$(mktemp -d)"
  make_repo "$repo" "$@"

  local out actual
  out=$(cd "$repo" && CLAUDE_PROJECT_DIR="$repo" bash "$repo/.claude/hooks/stop-validation.sh" 2>&1)
  actual=$?

  if [ "$actual" -eq "$expected" ]; then
    echo "  PASS  $name"
    PASSED=$((PASSED + 1))
  else
    echo "  FAIL  $name (expected exit $expected, got $actual)"
    echo "$out" | sed 's/^/          /'
    FAILED=$((FAILED + 1))
  fi
  rm -rf "$repo"
}

echo "stop-validation.sh — CHANGELOG hard gate"
echo

# The defect: the kit lives under .claude/ and keeps its own CHANGELOG there.
# A commit that updates the CHANGELOG governing the changed code must pass.
scenario 0 "kit source + kit CHANGELOG -> pass" \
  ".claude/scripts/check_xrefs.py" ".claude/CHANGELOG.md"

# Regression guard: the classic root path must keep working.
scenario 0 "product source + root CHANGELOG -> pass" \
  "packages/api/src/handler.ts" "CHANGELOG.md"

# The root CHANGELOG is an ancestor of everything, so it covers kit code too.
scenario 0 "kit source + root CHANGELOG -> pass" \
  ".claude/scripts/check_xrefs.py" "CHANGELOG.md"

# Negative: no CHANGELOG at all is still a hard gate.
scenario 2 "product source, no CHANGELOG -> block" \
  "packages/api/src/handler.ts"

# Negative that keeps the fix honest: .claude/ is NOT an ancestor of packages/,
# so the kit CHANGELOG must not launder a product change.
scenario 2 "product source + kit CHANGELOG only -> block" \
  "packages/api/src/handler.ts" ".claude/CHANGELOG.md"

echo
echo "passed: $PASSED   failed: $FAILED"
[ "$FAILED" -eq 0 ]
