set -euo pipefail

RELEASE_ID="$1"

DEPLOY_ROOT="/opt/memento/backend-prod"
RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_ID"

cd "$RELEASE_DIR"

if [ ! -f ".nvmrc" ]; then
  echo "ERROR: Release is missing .nvmrc"
  exit 1
fi

# Safety guard:
# deployment package.json must not compile application
# source during production dependency installation.
POSTINSTALL="$(
  node -e "
    const p = require('./package.json');
    process.stdout.write(p.scripts?.postinstall || '');
  " 2>/dev/null || true
)"

if [ -n "$POSTINSTALL" ]; then
  echo "ERROR: Deployment package.json still contains postinstall:"
  echo "  $POSTINSTALL"
  exit 1
fi

export NVM_DIR="$HOME/.nvm"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "ERROR: NVM is not installed for the deploy user"
  exit 1
fi

# NVM itself is not fully compatible with nounset.
set +u
. "$NVM_DIR/nvm.sh"

nvm install
NVM_INSTALL_STATUS=$?

if [ "$NVM_INSTALL_STATUS" -eq 0 ]; then
  nvm use
  NVM_USE_STATUS=$?
else
  NVM_USE_STATUS=1
fi

set -u

if [ "$NVM_INSTALL_STATUS" -ne 0 ]; then
  echo "ERROR: Failed installing Node version from .nvmrc"
  exit 1
fi

if [ "$NVM_USE_STATUS" -ne 0 ]; then
  echo "ERROR: Failed activating Node version from .nvmrc"
  exit 1
fi

echo "Node: $(node --version)"
echo "npm:  $(npm --version)"

# ────────────────────────────────────────────────────
# Yarn Classic
# ────────────────────────────────────────────────────
YARN_VERSION="$(yarn --version 2>/dev/null || true)"

case "$YARN_VERSION" in
  1.*)
    echo "Yarn: ${YARN_VERSION}"
    ;;

  *)
    echo "Installing Yarn Classic..."

    if command -v corepack >/dev/null 2>&1; then
      set +e
      corepack enable
      corepack prepare yarn@1.22.22 --activate
      COREPACK_STATUS=$?
      set -e

      if [ "$COREPACK_STATUS" -ne 0 ]; then
        npm install --global yarn@1.22.22 --force
      fi
    else
      npm install --global yarn@1.22.22 --force
    fi

    echo "Yarn: $(yarn --version)"
    ;;
esac

# ────────────────────────────────────────────────────
# PM2
#
# NVM global packages are Node-version-specific.
# Node 24 therefore needs its own PM2 CLI even when
# Node 22 previously had PM2 installed.
# ────────────────────────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 unavailable for $(node --version)"
  echo "Installing PM2..."

  npm install --global pm2
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "ERROR: PM2 unavailable after installation"
  exit 1
fi

echo "PM2: $(pm2 --version)"
echo "PM2 executable: $(command -v pm2)"

# ────────────────────────────────────────────────────
# Runtime dependency install
#
# No application compile occurs here because the
# deployment artifact has no root postinstall hook.
#
# Dependency package install scripts remain enabled.
# ────────────────────────────────────────────────────
yarn install \
  --production \
  --frozen-lockfile

echo "Runtime dependencies installed successfully."
