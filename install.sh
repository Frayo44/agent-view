#!/usr/bin/env bash
#
# Agent View Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/frayo44/agent-view/main/install.sh | bash
#

set -euo pipefail

APP=agent-view
REPO="frayo44/agent-view"

# Colors
MUTED='\033[0;2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

INSTALL_DIR="${AGENT_VIEW_INSTALL_DIR:-$HOME/.agent-view/bin}"

usage() {
    cat <<EOF
Agent View Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 1.0.0)
    -b, --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files

Examples:
    curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash -s -- --version 1.0.0
    ./install.sh --binary /path/to/agent-view
EOF
}

requested_version=""
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -b|--binary)
            if [[ -n "${2:-}" ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${RED}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${RED}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

mkdir -p "$INSTALL_DIR"

# Detect platform
detect_platform() {
    local os arch

    case "$(uname -s)" in
        Darwin) os="darwin" ;;
        Linux) os="linux" ;;
        *) echo -e "${RED}Unsupported OS: $(uname -s)${NC}"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        arm64|aarch64) arch="arm64" ;;
        *) echo -e "${RED}Unsupported architecture: $(uname -m)${NC}"; exit 1 ;;
    esac

    echo "${os}-${arch}"
}

if [ -n "$binary_path" ]; then
    if [ ! -f "$binary_path" ]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    platform=$(detect_platform)
    filename="$APP-$platform.tar.gz"

    if [ -z "$requested_version" ]; then
        url="https://github.com/$REPO/releases/latest/download/$filename"
        specific_version=$(curl -sI "https://github.com/$REPO/releases/latest" | grep -i "location:" | sed -n 's/.*tag\/v\([^[:space:]]*\).*/\1/p' | tr -d '\r')

        if [[ -z "$specific_version" ]]; then
            # Fallback to API
            specific_version=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')
        fi

        if [[ -z "$specific_version" ]]; then
            echo -e "${RED}Failed to fetch version information${NC}"
            exit 1
        fi
    else
        requested_version="${requested_version#v}"
        url="https://github.com/$REPO/releases/download/v${requested_version}/$filename"
        specific_version=$requested_version

        # Verify release exists
        http_status=$(curl -sI -o /dev/null -w "%{http_code}" "https://github.com/$REPO/releases/tag/v${requested_version}")
        if [ "$http_status" = "404" ]; then
            echo -e "${RED}Error: Release v${requested_version} not found${NC}"
            echo -e "${MUTED}Available releases: https://github.com/$REPO/releases${NC}"
            exit 1
        fi
    fi
fi

check_version() {
    if command -v agent-view >/dev/null 2>&1; then
        installed_version=$(agent-view --version 2>/dev/null || echo "")
        if [[ "$installed_version" == "$specific_version" ]]; then
            echo -e "${MUTED}Version ${NC}$specific_version${MUTED} already installed${NC}"
            exit 0
        else
            echo -e "${MUTED}Installed version: ${NC}$installed_version"
        fi
    fi
}

download_and_install() {
    echo -e "\n${MUTED}Installing ${NC}$APP ${MUTED}version: ${NC}$specific_version"
    echo -e "${MUTED}Platform: ${NC}$platform"

    local tmp_dir="${TMPDIR:-/tmp}/$APP-$$"
    mkdir -p "$tmp_dir"

    echo -e "${MUTED}Downloading...${NC}"
    if ! curl -#fL -o "$tmp_dir/$filename" "$url"; then
        echo -e "${RED}Download failed. The release may not have binaries for your platform.${NC}"
        echo -e "${MUTED}You can install from source instead:${NC}"
        echo -e "  git clone https://github.com/$REPO.git"
        echo -e "  cd agent-view && bun install && bun run build"
        rm -rf "$tmp_dir"
        exit 1
    fi

    # Extract tarball
    tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"

    # Find the binary (could be in subdirectory)
    local binary_path
    if [ -f "$tmp_dir/$APP" ]; then
        binary_path="$tmp_dir/$APP"
    elif [ -f "$tmp_dir/$APP-$platform/$APP" ]; then
        binary_path="$tmp_dir/$APP-$platform/$APP"
    else
        echo -e "${RED}Binary not found in archive${NC}"
        rm -rf "$tmp_dir"
        exit 1
    fi

    mv "$binary_path" "$INSTALL_DIR/$APP"
    chmod 755 "$INSTALL_DIR/$APP"
    rm -rf "$tmp_dir"

    # Create short alias
    ln -sf "$INSTALL_DIR/$APP" "$INSTALL_DIR/av"
}

install_from_binary() {
    echo -e "\n${MUTED}Installing ${NC}$APP ${MUTED}from: ${NC}$binary_path"
    cp "$binary_path" "$INSTALL_DIR/$APP"
    chmod 755 "$INSTALL_DIR/$APP"
    ln -sf "$INSTALL_DIR/$APP" "$INSTALL_DIR/av"
}

if [ -n "$binary_path" ]; then
    install_from_binary
else
    check_version
    download_and_install
fi

# Add to PATH
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        return 0
    elif [[ -w $config_file ]]; then
        echo -e "\n# agent-view" >> "$config_file"
        echo "$command" >> "$config_file"
        echo -e "${MUTED}Added to PATH in ${NC}$config_file"
    fi
}

if [[ "$no_modify_path" != "true" ]]; then
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        current_shell=$(basename "$SHELL")
        case $current_shell in
            fish)
                config_file="$HOME/.config/fish/config.fish"
                [[ -f "$config_file" ]] && add_to_path "$config_file" "fish_add_path $INSTALL_DIR"
                ;;
            zsh)
                config_file="${ZDOTDIR:-$HOME}/.zshrc"
                [[ -f "$config_file" ]] && add_to_path "$config_file" "export PATH=\"$INSTALL_DIR:\$PATH\""
                ;;
            *)
                config_file="$HOME/.bashrc"
                [[ -f "$config_file" ]] && add_to_path "$config_file" "export PATH=\"$INSTALL_DIR:\$PATH\""
                ;;
        esac
    fi
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
echo ""
echo -e "  Run ${GREEN}agent-view${NC} or ${GREEN}av${NC} to start"
echo ""
echo -e "  ${MUTED}Binary: ${NC}$INSTALL_DIR/$APP"
echo ""
echo -e "  ${MUTED}Restart your shell or run:${NC}"
echo -e "  export PATH=\"$INSTALL_DIR:\$PATH\""
echo ""
