#!/usr/bin/env bash
set -euo pipefail
if [ -z "${AGENT_WORKTREE_ROOT:-}" ]; then
  echo "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on." >&2
  exit 1
fi
REVIEW_PATH="${AGENT_WORKTREE_ROOT}-review-c"
if [ ! -d "$REVIEW_PATH" ]; then
  git -C "$AGENT_WORKTREE_ROOT" worktree add --detach "$REVIEW_PATH"
fi
cd "$REVIEW_PATH"
AGENT_RELAY_TOKEN="$AGENT_RELAY_TOKEN_C" exec claude "$@"
