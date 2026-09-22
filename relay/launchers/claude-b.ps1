if (-not $env:AGENT_WORKTREE_ROOT) {
  Write-Error "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on."
  exit 1
}
$reviewPath = "$($env:AGENT_WORKTREE_ROOT)-review-b"
if (-not (Test-Path $reviewPath)) {
  # Detached, not a branch checkout -- shares the primary clone's object
  # database, so it sees claude-a's unpushed commits too, but never
  # contends with the primary worktree over which branch is checked out.
  git -C $env:AGENT_WORKTREE_ROOT worktree add --detach $reviewPath
}
Set-Location $reviewPath
$env:AGENT_RELAY_TOKEN = $env:AGENT_RELAY_TOKEN_B
claude @args
