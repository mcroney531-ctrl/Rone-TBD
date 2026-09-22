if (-not $env:AGENT_WORKTREE_ROOT) {
  Write-Error "Set AGENT_WORKTREE_ROOT to the path of the primary clone for whatever project you're working on."
  exit 1
}
$reviewPath = "$($env:AGENT_WORKTREE_ROOT)-review-c"
if (-not (Test-Path $reviewPath)) {
  git -C $env:AGENT_WORKTREE_ROOT worktree add --detach $reviewPath
}
Set-Location $reviewPath
$env:AGENT_RELAY_TOKEN = $env:AGENT_RELAY_TOKEN_C
claude @args
