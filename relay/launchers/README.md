# Per-account launchers

If claude-a/b/c all run on the same machine/OS user, a single global
`AGENT_RELAY_TOKEN` in your shell profile means whichever token you last
exported becomes every session's identity — the relay can't tell claude-b
from claude-a if they're both handed A's token.

Fix: keep each identity's token in its own named variable, and only ever
export the generic `AGENT_RELAY_TOKEN` for the lifetime of one launched
process. `.mcp.json` / `~/.claude.json` still just reference
`${AGENT_RELAY_TOKEN}` — same config file, different value per launch.

A second, related trap surfaced in real use: two Claude Code windows
editing the *same* git working directory at once. One session's identity
was misconfigured, so it authenticated as claude-b while actually doing
claude-a's implementation work -- producing perfectly valid but
wrongly-attributed relay history, caught only because a human/agent
noticed the attribution looked off. The launchers now fix this
structurally instead of relying on discipline: claude-a always gets the
one primary working directory (the only one that commits/pushes), and
claude-b/c/codex each get their own dedicated `git worktree`, created
automatically on first launch. Worktrees share the primary clone's
object database -- a review agent can `git checkout <sha>` to inspect
even claude-a's unpushed commits -- but each agent has its own physically
separate directory, so two sessions can never clobber the same files
again, even by accident.

**Rule: one agent, one directory, always.** Never point two of these
launchers at the same `AGENT_WORKTREE_ROOT` and run them as the same
identity in two windows -- that's the scenario that caused the mixup.

## Setup (once per machine)

In your shell profile (`~/.bashrc`, `~/.zshrc`, or the PowerShell profile
equivalent), set the four real token values — never the generic name:

```
export AGENT_RELAY_TOKEN_A="<claude-a token>"
export AGENT_RELAY_TOKEN_B="<claude-b token>"
export AGENT_RELAY_TOKEN_C="<claude-c token>"
export AGENT_RELAY_TOKEN_CODEX="<codex-gpt token>"
```

## Setup (once per project)

Set `AGENT_WORKTREE_ROOT` to the path of your primary clone of whatever
project you're currently working on -- claude-a's launcher uses this path
directly; claude-b/c/codex derive their own worktree paths from it
(`<root>-review-b`, `<root>-review-c`, `<root>-review-codex`) and create
them automatically the first time you launch.

```
export AGENT_WORKTREE_ROOT="/path/to/parlay-helper"
```
(PowerShell: `$env:AGENT_WORKTREE_ROOT = "C:\Users\you\parlay-helper"`.)

## Usage

`./launchers/claude-a.sh` (or `.ps1`) instead of running `claude` directly.
Each script sets `AGENT_RELAY_TOKEN` for that one process only, `cd`s into
the identity's own directory, then execs the real CLI — the token export
never leaks into your interactive shell, and the directory binding means
the identity and the workspace can't drift apart.

## Verifying identity

The relay's `whoami` tool returns which agent your current token actually
authenticates as. Worth calling once at the start of any session, before
anything mutating -- especially right after resuming from a break, since
a stale or wrong `AGENT_RELAY_TOKEN` produces a session that looks
completely normal but silently attributes its work to the wrong identity.
