#!/usr/bin/env sh
# sm4rt CLI installer.
#
#   curl -fsSL https://cloud.<your-domain>/cli | sh          # pre-configured
#   curl -fsSL https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/cli/install-cli.sh | sh
#
# Installs the `sm4rt` wrapper into ~/.local/bin (or /usr/local/bin as root)
# and, when SM4RT_DEFAULT_ENDPOINT is baked in by the control plane, writes
# the initial endpoint config. Installs aws-cli if missing (best effort).
set -eu

# @ENDPOINT@ is replaced by the control plane when served from /cli
SM4RT_DEFAULT_ENDPOINT="${SM4RT_DEFAULT_ENDPOINT:-@ENDPOINT@}"
RAW_BASE="${SM4RT_CLI_BASE:-https://raw.githubusercontent.com/mbergo/sm4rt-cloud/main/cli}"

if [ "$(id -u)" = "0" ]; then
  BIN_DIR="/usr/local/bin"
else
  BIN_DIR="${HOME}/.local/bin"
  mkdir -p "$BIN_DIR"
fi

echo "→ installing sm4rt to ${BIN_DIR}/sm4rt"
curl -fsSL "${RAW_BASE}/sm4rt" -o "${BIN_DIR}/sm4rt"
chmod +x "${BIN_DIR}/sm4rt"

# initial endpoint (only when baked in and not already configured)
case "$SM4RT_DEFAULT_ENDPOINT" in
  http://*|https://*)
    CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/sm4rt"
    if [ ! -f "${CONFIG_DIR}/endpoint" ]; then
      mkdir -p "$CONFIG_DIR"
      printf '%s\n' "$SM4RT_DEFAULT_ENDPOINT" > "${CONFIG_DIR}/endpoint"
      echo "→ default endpoint: ${SM4RT_DEFAULT_ENDPOINT}"
    fi
    ;;
esac

# aws-cli (best effort, skip if present)
if ! command -v aws >/dev/null 2>&1; then
  echo "→ aws-cli not found — attempting install"
  OS="$(uname -s)"; ARCH="$(uname -m)"
  if [ "$OS" = "Linux" ]; then
    TMP="$(mktemp -d)"
    ZIP_ARCH="x86_64"; [ "$ARCH" = "aarch64" ] && ZIP_ARCH="aarch64"
    if curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-${ZIP_ARCH}.zip" -o "$TMP/awscli.zip" 2>/dev/null; then
      if command -v unzip >/dev/null 2>&1; then
        unzip -q "$TMP/awscli.zip" -d "$TMP"
        if [ "$(id -u)" = "0" ]; then
          "$TMP/aws/install" >/dev/null 2>&1 || true
        else
          "$TMP/aws/install" -i "$HOME/.local/aws-cli" -b "$BIN_DIR" >/dev/null 2>&1 || true
        fi
      else
        echo "  unzip not available — install aws-cli manually"
      fi
    fi
    rm -rf "$TMP"
  elif [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install awscli >/dev/null 2>&1 || true
  fi
  if command -v aws >/dev/null 2>&1 || [ -x "${BIN_DIR}/aws" ]; then
    echo "  ✔ aws-cli installed"
  else
    echo "  ✘ could not install aws-cli automatically — https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  fi
fi

case ":$PATH:" in
  *":${BIN_DIR}:"*) ;;
  *) echo "⚠ add ${BIN_DIR} to your PATH (e.g. echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.bashrc)" ;;
esac

echo ""
echo "✅ done. Try:"
echo "     sm4rt configure        # if you need to change the endpoint"
echo "     sm4rt s3 mb s3://demo && sm4rt s3 ls"
