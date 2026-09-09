#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Register the Google Flow Browser MCP with Claude Code
# Uses the official `claude mcp add` CLI (writes to Claude Code's own config).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCOPE="${1:-user}" # local | user | project

log()  { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] INFO  $*" >&2; }
die()  { echo "[$(date '+%Y-%m-%dT%H:%M:%S')] ERROR $*" >&2; exit 1; }

command -v claude >/dev/null 2>&1 || die "Claude Code CLI not found (install: https://docs.claude.com/claude-code)"

log "Registering google-flow-browser MCP with Claude Code (scope: $SCOPE)"
claude mcp add google-flow-browser -s "$SCOPE" -- node "$PROJECT_DIR/src/index.js"

log "Registered. Verify with: claude mcp list"
log "Restart any running Claude Code session for the change to take effect."
