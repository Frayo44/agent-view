#!/usr/bin/env bash
#
# Agent View Uninstaller
# Usage: curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/uninstall.sh | bash
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

INSTALL_DIR="${AGENT_VIEW_INSTALL_DIR:-$HOME/.agent-view}"
BIN_DIR="${AGENT_VIEW_BIN_DIR:-$HOME/.local/bin}"

log() {
  echo -e "${BLUE}[agent-view]${NC} $1"
}

success() {
  echo -e "${GREEN}[agent-view]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[agent-view]${NC} $1"
}

main() {
  echo ""
  echo -e "${BLUE}╭───────────────────────────────────╮${NC}"
  echo -e "${BLUE}│      ${RED}Agent View Uninstaller${BLUE}       │${NC}"
  echo -e "${BLUE}╰───────────────────────────────────╯${NC}"
  echo ""

  # Remove binaries
  if [ -f "$BIN_DIR/agent-view" ]; then
    log "Removing $BIN_DIR/agent-view..."
    rm -f "$BIN_DIR/agent-view"
  fi

  if [ -f "$BIN_DIR/av" ]; then
    log "Removing $BIN_DIR/av..."
    rm -f "$BIN_DIR/av"
  fi

  # Remove installation directory
  if [ -d "$INSTALL_DIR" ]; then
    log "Removing $INSTALL_DIR..."
    rm -rf "$INSTALL_DIR"
  fi

  echo ""
  success "Agent View has been uninstalled"
  echo ""
  warn "Note: PATH entries in shell config files were not removed"
  warn "You may want to manually remove the Agent View PATH entry from your shell config"
  echo ""
}

main "$@"
