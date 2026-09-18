# Per-account launchers

If claude-a/b/c all run on the same machine/OS user, a single global
`AGENT_RELAY_TOKEN` in your shell profile means whichever token you last
exported becomes every session's identity — the relay can't tell claude-b
from claude-a if they're both handed A's token.

Fix: keep each identity's token in its own named variable, and only ever
export the generic `AGENT_RELAY_TOKEN` for the lifetime of one launched
process. `.mcp.json` / `~/.claude.json` still just reference
`${AGENT_RELAY_TOKEN}` — same config file, different value per launch.

## Setup (once)

In your shell profile (`~/.bashrc`, `~/.zshrc`, or the PowerShell profile
equivalent), set the four real values — never the generic name:

```
export AGENT_RELAY_TOKEN_A="<claude-a token>"
export AGENT_RELAY_TOKEN_B="<claude-b token>"
export AGENT_RELAY_TOKEN_C="<claude-c token>"
export AGENT_RELAY_TOKEN_CODEX="<codex-gpt token>"
```

## Usage

`./launchers/claude-a.sh` (or `.ps1`) instead of running `claude` directly.
Each script sets `AGENT_RELAY_TOKEN` for that one process only, then execs
the real CLI — the export never leaks into your interactive shell.
