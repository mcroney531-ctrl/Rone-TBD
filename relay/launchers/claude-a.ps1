if (-not $env:AGENT_WORKTREE_ROOT) {
  Write-Error "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on."
  exit 1
}
Set-Location $env:AGENT_WORKTREE_ROOT
$env:AGENT_RELAY_TOKEN = $env:AGENT_RELAY_TOKEN_A
claude @args
