#!/usr/bin/env bash
# Install / self-restore Medusa Cloud's official CLI (`mcloud`) under a persistent home dir.
# Official docs: https://docs.medusajs.com/cloud/cli  (npm install @medusajs/mcloud -g ; requires Node.js v22+ ; verify: mcloud --version)
# Everything lands under $MCLOUD_HOME (default: $HOME/.local) so it survives box wipes outside $HOME.
# Does NOT log in. Login is a human step: `mcloud login` (browser) or MCLOUD_TOKEN for CI (see docs).
set -euo pipefail
PREFIX="${MCLOUD_HOME:-$HOME/.local}"
NODE_MAJOR=22
NODE_DIR="$PREFIX/opt/node$NODE_MAJOR"
MCLOUD_PREFIX="$PREFIX/opt/mcloud"
BIN="$PREFIX/bin"
mkdir -p "$BIN" "$PREFIX/opt"

node_ok() { command -v "$1" >/dev/null 2>&1 && [ "$("$1" -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR" ]; }

# 1) A Node >= 22 (docs prerequisite). Use system node if new enough, else a private official Node build.
if node_ok node; then NODE="$(command -v node)"
elif node_ok "$NODE_DIR/bin/node"; then NODE="$NODE_DIR/bin/node"
else
  arch=$(uname -m); case "$arch" in x86_64) a=x64;; aarch64|arm64) a=arm64;; *) echo "FAIL: unsupported arch $arch" >&2; exit 1;; esac
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  ver=$(curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt" | grep -oE "node-v[0-9.]+-$os-$a.tar.gz" | head -1)
  [ -n "$ver" ] || { echo "FAIL: could not resolve Node $NODE_MAJOR build from nodejs.org" >&2; exit 1; }
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/$ver" -o "$tmp/$ver"
  curl -fsSL "https://nodejs.org/dist/latest-v$NODE_MAJOR.x/SHASUMS256.txt" | grep " $ver\$" | (cd "$tmp" && sha256sum -c -) >/dev/null || { echo "FAIL: Node checksum mismatch" >&2; exit 1; }
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"; tar -xzf "$tmp/$ver" -C "$NODE_DIR" --strip-components=1
  NODE="$NODE_DIR/bin/node"
fi
NPM="$(dirname "$NODE")/npm"; [ -x "$NPM" ] || NPM="$(command -v npm)"

# 2) The official package, installed globally into a private prefix (docs: npm install @medusajs/mcloud -g).
PATH="$(dirname "$NODE"):$PATH" "$NPM" install -g --prefix "$MCLOUD_PREFIX" @medusajs/mcloud >/dev/null

# 3) Stable wrapper on PATH that always runs mcloud with Node >= 22.
rm -f "$BIN/mcloud"  # may be an old npm symlink; never write through it
cat > "$BIN/mcloud" <<WRAP
#!/usr/bin/env bash
exec "$NODE" "$MCLOUD_PREFIX/lib/node_modules/@medusajs/mcloud/bin/run.js" "\$@"
WRAP
chmod +x "$BIN/mcloud"
grep -qs "$BIN" "$HOME/.bashrc" || echo "export PATH=\"$BIN:\$PATH\"" >> "$HOME/.bashrc"

# 4) Keep a copy of this script next to the install for self-restore after a wipe.
mkdir -p "$PREFIX/share/mcloud"; cp "$0" "$PREFIX/share/mcloud/setup-mcloud.sh" 2>/dev/null || true

echo "mcloud installed: $("$BIN/mcloud" --version)"
echo "node used: $("$NODE" --version)  wrapper: $BIN/mcloud"
echo "restore: bash $PREFIX/share/mcloud/setup-mcloud.sh"
echo "next (human): mcloud login   # not done by this script"
