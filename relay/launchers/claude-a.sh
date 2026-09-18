#!/usr/bin/env bash
set -euo pipefail
AGENT_RELAY_TOKEN="$AGENT_RELAY_TOKEN_A" exec claude "$@"
