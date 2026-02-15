#!/usr/bin/env bash
#
# Agent View Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash
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

error() {
  echo -e "${RED}[agent-view]${NC} $1"
  exit 1
}

# Detect OS and architecture
detect_platform() {
  local os arch

  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) error "Unsupported OS: $(uname -s)" ;;
  esac

  case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac

  echo "${os}-${arch}"
}

# Check if Bun is installed
check_bun() {
  if command -v bun &> /dev/null; then
    return 0
  fi
  return 1
}

# Install Bun
install_bun() {
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash

  # Source the new path
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"

  if ! check_bun; then
    error "Failed to install Bun. Please install it manually: https://bun.sh"
  fi
  success "Bun installed successfully"
}

# Clone or update repository
setup_repo() {
  if [ -d "$INSTALL_DIR" ]; then
    log "Updating existing installation..."
    cd "$INSTALL_DIR"
    git pull --quiet
  else
    log "Cloning agent-view..."
    git clone --depth 1 https://github.com/frayo44/agent-view.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
}

# Build the project
build_project() {
  log "Installing dependencies..."
  bun install --silent

  log "Building agent-view..."
  bun run build
}

# Create launcher script
create_launcher() {
  mkdir -p "$BIN_DIR"

  cat > "$BIN_DIR/agent-view" << EOF
#!/usr/bin/env bash
# Agent View launcher
exec bun run "$INSTALL_DIR/dist/index.js" "\$@"
EOF

  chmod +x "$BIN_DIR/agent-view"

  # Create short alias
  ln -sf "$BIN_DIR/agent-view" "$BIN_DIR/av"
}

# Add to PATH if needed
setup_path() {
  local shell_config=""
  local path_export="export PATH=\"\$PATH:$BIN_DIR\""

  # Detect shell config file
  if [ -n "${ZSH_VERSION:-}" ] || [ "$SHELL" = "/bin/zsh" ]; then
    shell_config="$HOME/.zshrc"
  elif [ -n "${BASH_VERSION:-}" ] || [ "$SHELL" = "/bin/bash" ]; then
    shell_config="$HOME/.bashrc"
  fi

  # Check if already in PATH
  if echo "$PATH" | grep -q "$BIN_DIR"; then
    return 0
  fi

  if [ -n "$shell_config" ] && [ -f "$shell_config" ]; then
    if ! grep -q "agent-view" "$shell_config" 2>/dev/null; then
      echo "" >> "$shell_config"
      echo "# Agent View" >> "$shell_config"
      echo "$path_export" >> "$shell_config"
      warn "Added $BIN_DIR to PATH in $shell_config"
      warn "Please restart your shell or run: source $shell_config"
    fi
  else
    warn "Please add $BIN_DIR to your PATH manually"
  fi
}

# Main installation
main() {
  echo ""
  echo -e "${BLUE}╭───────────────────────────────────╮${NC}"
  echo -e "${BLUE}│       ${GREEN}Agent View Installer${BLUE}        │${NC}"
  echo -e "${BLUE}╰───────────────────────────────────╯${NC}"
  echo ""

  local platform
  platform=$(detect_platform)
  log "Detected platform: $platform"

  # Check for Bun
  if ! check_bun; then
    warn "Bun is not installed"
    install_bun
  else
    log "Bun is already installed: $(bun --version)"
  fi

  # Setup repository
  setup_repo

  # Build
  build_project

  # Create launcher
  create_launcher

  # Setup PATH
  setup_path

  echo ""
  success "Installation complete!"
  echo ""
  echo -e "  Run ${GREEN}agent-view${NC} or ${GREEN}av${NC} to start"
  echo ""
  echo -e "  Install location: ${BLUE}$INSTALL_DIR${NC}"
  echo -e "  Binary location:  ${BLUE}$BIN_DIR/agent-view${NC}"
  echo ""
}

main "$@"
