#!/usr/bin/env bash
set -euo pipefail
if [ -z "${AGENT_WORKTREE_ROOT:-}" ]; then
  echo "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on." >&2
  exit 1
fi
REVIEW_PATH="${AGENT_WORKTREE_ROOT}-review-b"
if [ ! -d "$REVIEW_PATH" ]; then
  # Detached, not a branch checkout -- shares the primary clone's object
  # database (sees claude-a's unpushed commits) without contending over
  # which branch is checked out where.
  git -C "$AGENT_WORKTREE_ROOT" worktree add --detach "$REVIEW_PATH"
fi
cd "$REVIEW_PATH"
AGENT_RELAY_TOKEN="$AGENT_RELAY_TOKEN_B" exec claude "$@"
