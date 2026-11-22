#!/usr/bin/env bash
# Deploy the API from your machine, the same way GitHub Actions does.
#
# Usage:  scripts/deploy.sh prod     (from main, asks you to type DEPLOY)
#         scripts/deploy.sh dev      (from dev)
#
# Mirrors .github/workflows/deploy-<env>.yml step for step: the same branch
# checks, the same lint/test/build gates, the same release artifact, and the
# very same remote scripts (scripts/deploy/<env>/*.sh are copied verbatim from
# the workflow; a test keeps them in sync). On the server a release is
# uploaded to $DEPLOY_ROOT/releases/<id>, dependencies are installed there,
# migrations run, the `current` symlink switches, PM2 reloads, and /ready is
# checked. If anything fails after the switch, the remote script rolls back
# to the previous release on its own.
#
# Not included: the workflow's PostHog and Sign in with Apple ".env sync"
# steps (they only copy GitHub secrets into the server's .env, which already
# has them) and the Discord notification.
#
# Settings come from .deploy.env (see .deploy.env.example; it is git-ignored).
set -euo pipefail

ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in
  prod)
    BRANCH="main"
    DEPLOY_ROOT="/opt/memento/backend-prod"
    ;;
  dev)
    BRANCH="dev"
    DEPLOY_ROOT="/opt/memento/backend-dev"
    ;;
  *)
    echo "Usage: scripts/deploy.sh prod|dev" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

# ── Settings ────────────────────────────────────────────────────────────
[ -f .deploy.env ] || fail "Missing .deploy.env. Copy .deploy.env.example and fill it in."
set -a
# shellcheck disable=SC1091
. ./.deploy.env
set +a
: "${DEPLOY_SSH_HOST:?Set DEPLOY_SSH_HOST in .deploy.env}"
: "${DEPLOY_SSH_USER:?Set DEPLOY_SSH_USER in .deploy.env}"
: "${DEPLOY_SSH_KEY:?Set DEPLOY_SSH_KEY in .deploy.env (path to your private key)}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
[ -f "$DEPLOY_SSH_KEY" ] || fail "SSH key not found: $DEPLOY_SSH_KEY"

SSH_OPTS=(
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
  -o ServerAliveInterval=10
  -o ServerAliveCountMax=3
  -i "$DEPLOY_SSH_KEY"
  -p "$DEPLOY_SSH_PORT"
)
TARGET="$DEPLOY_SSH_USER@$DEPLOY_SSH_HOST"

remote() {
  ssh "${SSH_OPTS[@]}" "$TARGET" "$@"
}

remote_script() {
  # Same as the workflow: the script is streamed over SSH with the release id.
  ssh -T "${SSH_OPTS[@]}" "$TARGET" "bash -s -- '$RELEASE_ID'" \
    < "scripts/deploy/$ENVIRONMENT/$1"
}

# ── 1. Validate branch (the workflow's "validate" job) ─────────────────
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "$BRANCH" ] || fail "Deploy $ENVIRONMENT from '$BRANCH', not '$CURRENT_BRANCH'."
[ -z "$(git status --porcelain)" ] || fail "Commit or stash your changes first; the working tree must be clean."
git fetch -q origin "$BRANCH"
[ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$BRANCH")" ] \
  || fail "Local $BRANCH is not in sync with origin/$BRANCH. Pull or push first."
COMMIT="$(git rev-parse HEAD)"

if [ "$ENVIRONMENT" = "prod" ]; then
  echo "About to deploy $COMMIT (main) to PRODUCTION on $DEPLOY_SSH_HOST."
  read -r -p 'Type DEPLOY to continue: ' CONFIRMATION
  [ "$CONFIRMATION" = "DEPLOY" ] || fail "Aborted."
fi

# ── 2. The same gates CI runs ───────────────────────────────────────────
echo "==> Installing dependencies"
yarn install --frozen-lockfile
echo "==> Lint"
yarn lint
echo "==> API contract"
yarn contracts:check
echo "==> Tests"
yarn test
echo "==> Build"
yarn build
[ -d build ] && [ -n "$(find build -type f -print -quit)" ] || fail "Build produced no files."

# ── 3. Release artifact (identical to the workflow) ─────────────────────
echo "==> Preparing release artifact"
rm -rf release
mkdir -p release
cp -a build release/build
cp package.json yarn.lock ecosystem.config.js .nvmrc .npmrc openapi.json openapi.sha256 release/
node <<'NODE'
const fs = require('fs');
const path = 'release/package.json';
const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
if (pkg.scripts?.postinstall) {
  console.log(`Removing application postinstall from deployment artifact: ${pkg.scripts.postinstall}`);
  delete pkg.scripts.postinstall;
}
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
NODE

# ── 4. Upload ───────────────────────────────────────────────────────────
RELEASE_ID="${COMMIT}-manual-$(date -u +%Y%m%dT%H%M%SZ)"
echo "==> Checking SSH access to $TARGET"
remote "echo connected as \$(whoami) on \$(hostname)"
echo "==> Uploading release $RELEASE_ID"
remote "mkdir -p '$DEPLOY_ROOT/releases/$RELEASE_ID'"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" ./release/ "$TARGET:$DEPLOY_ROOT/releases/$RELEASE_ID/"

# ── 5. Prepare runtime, then activate (rolls back by itself on failure) ─
echo "==> Preparing release runtime on the server"
remote_script prepare-release.sh
echo "==> Activating release"
if ! remote_script activate-release.sh; then
  if [ -f "scripts/deploy/$ENVIRONMENT/cleanup-failed-release.sh" ]; then
    remote_script cleanup-failed-release.sh || true
  fi
  fail "Activation failed. The previous release should still be serving; check PM2 on the server."
fi

echo
echo "Deployed $COMMIT to $ENVIRONMENT as release $RELEASE_ID."
