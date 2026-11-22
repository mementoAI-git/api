set -euo pipefail

RELEASE_ID="$1"

DEPLOY_ROOT="/opt/memento/backend-dev"
RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_ID"

cd "$RELEASE_DIR"

if [ ! -f ".nvmrc" ]; then
  echo "ERROR: Release is missing .nvmrc"
  exit 1
fi

export NVM_DIR="$HOME/.nvm"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "ERROR: NVM is not installed for the deploy user"
  exit 1
fi

# nvm itself is not fully compatible with `set -u`.
set +u
. "$NVM_DIR/nvm.sh"

if ! nvm install; then
  echo "ERROR: Unable to install Node version from .nvmrc"
  exit 1
fi

if ! nvm use; then
  echo "ERROR: Unable to activate Node version from .nvmrc"
  exit 1
fi

set -u

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"

# Verify the deployment copy cannot accidentally rebuild
# TypeScript source on the server.
POSTINSTALL="$(
  node -e "
    const p = require('./package.json');
    process.stdout.write(p.scripts?.postinstall || '');
  "
)"

if [ -n "$POSTINSTALL" ]; then
  echo "ERROR: Deployment package.json contains postinstall:"
  echo "  $POSTINSTALL"
  exit 1
fi

# ── Yarn Classic ───────────────────────────────────
YARN_VERSION="$(yarn --version 2>/dev/null || true)"

case "$YARN_VERSION" in
  1.*)
    echo "Yarn: $YARN_VERSION"
    ;;

  *)
    echo "Installing Yarn Classic..."
    npm install --global yarn@1.22.22 --force
    echo "Yarn: $(yarn --version)"
    ;;
esac

# ── Runtime dependencies ───────────────────────────
#
# Application code was already compiled in CI.
# Dependency install scripts are still allowed.
yarn install \
  --production \
  --frozen-lockfile

# ── PM2 ────────────────────────────────────────────
#
# NVM keeps global npm packages per Node installation.
# A new Node version therefore needs PM2 installed for
# that Node version too.
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 unavailable for $(node --version)"
  echo "Installing PM2..."

  npm install --global pm2
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: PM2 unavailable after installation"
  exit 1
fi

echo "PM2 executable: $(command -v pm2)"

echo "Release runtime prepared successfully."
