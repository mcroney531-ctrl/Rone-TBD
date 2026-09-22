#!/usr/bin/env bash
set -euo pipefail
if [ -z "${AGENT_WORKTREE_ROOT:-}" ]; then
  echo "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on." >&2
  exit 1
fi
cd "$AGENT_WORKTREE_ROOT"
AGENT_RELAY_TOKEN="$AGENT_RELAY_TOKEN_A" exec claude "$@"
