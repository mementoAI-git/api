set -euo pipefail

RELEASE_ID="$1"

DEPLOY_ROOT="/opt/memento/backend-prod"
RELEASES="$DEPLOY_ROOT/releases"
CURRENT="$DEPLOY_ROOT/current"

NEW_RELEASE="$RELEASES/$RELEASE_ID"

API_APP="memento-backend-prod"
WORKER_APP="memento-backend-prod-worker"

READINESS_URL="http://127.0.0.1:4001/ready"

mkdir -p "$RELEASES"

if [ ! -d "$NEW_RELEASE" ]; then
  echo "ERROR: New release does not exist:"
  echo "  $NEW_RELEASE"
  exit 1
fi

# ────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────
load_nvm() {
  export NVM_DIR="$HOME/.nvm"

  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "ERROR: NVM is unavailable"
    return 1
  fi

  set +u
  . "$NVM_DIR/nvm.sh"
  STATUS=$?
  set -u

  return "$STATUS"
}

use_release_node() {
  RELEASE_DIR="$1"

  if ! load_nvm; then
    return 1
  fi

  OLD_PWD="$PWD"
  cd "$RELEASE_DIR"

  if [ -f ".nvmrc" ]; then
    echo "Selecting Node from:"
    echo "  $RELEASE_DIR/.nvmrc"

    set +u
    nvm use
    NVM_STATUS=$?
    set -u
  else
    # Old pre-release-layout deployments may not have
    # included .nvmrc.
    echo "WARNING: Legacy release has no .nvmrc:"
    echo "  $RELEASE_DIR"

    echo "Trying NVM default..."

    set +u
    nvm use default >/dev/null 2>&1
    NVM_STATUS=$?
    set -u

    if [ "$NVM_STATUS" -ne 0 ]; then
      echo "NVM default unavailable."
      NVM_STATUS=0
    fi
  fi

  cd "$OLD_PWD"

  if [ "$NVM_STATUS" -ne 0 ]; then
    echo "ERROR: Unable to select Node version"
    return 1
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node unavailable"
    return 1
  fi

  # Legacy fallback:
  #
  # If the legacy/default Node installation doesn't
  # contain PM2, use the new release's Node version.
  #
  # That Node version was guaranteed to have PM2
  # installed during Prepare release runtime.
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "PM2 unavailable under current Node."
    echo "Trying deployment Node as PM2 control runtime..."

    cd "$NEW_RELEASE"

    set +u
    nvm use >/dev/null 2>&1
    FALLBACK_STATUS=$?
    set -u

    cd "$OLD_PWD"

    if [ "$FALLBACK_STATUS" -ne 0 ]; then
      echo "ERROR: Could not select deployment Node"
      return 1
    fi
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "ERROR: PM2 unavailable"
    return 1
  fi

  echo "Control Node: $(node --version)"
  echo "PM2: $(command -v pm2)"

  return 0
}

switch_release() {
  TARGET="$1"

  if [ ! -d "$TARGET" ]; then
    echo "ERROR: Cannot activate missing release:"
    echo "  $TARGET"
    return 1
  fi

  rm -f "$DEPLOY_ROOT/.current-next"

  ln -s \
    "$TARGET" \
    "$DEPLOY_ROOT/.current-next"

  # Atomic replacement on the same filesystem.
  mv -Tf \
    "$DEPLOY_ROOT/.current-next" \
    "$CURRENT"
}

reload_apps() {
  cd "$DEPLOY_ROOT"

  echo "Reloading production PM2 applications..."

  # API
  if pm2 describe "$API_APP" >/dev/null 2>&1; then
    pm2 reload \
      "$API_APP" \
      --update-env
  else
    echo "$API_APP is not registered; starting from ecosystem config."

    MEMENTO_ENV=prod \
      pm2 start \
      "$DEPLOY_ROOT/ecosystem.config.js" \
      --only "$API_APP"
  fi

  # Worker
  if pm2 describe "$WORKER_APP" >/dev/null 2>&1; then
    pm2 reload \
      "$WORKER_APP" \
      --update-env
  else
    echo "$WORKER_APP is not registered; starting from ecosystem config."

    MEMENTO_ENV=prod \
      pm2 start \
      "$DEPLOY_ROOT/ecosystem.config.js" \
      --only "$WORKER_APP"
  fi

  pm2 save

  echo "PM2 reload completed."
}

run_release_migrations() {
  echo "Running release database migrations..."
  cd "$NEW_RELEASE"
  MIGRATION_STATUS=0
  DOTENV_CONFIG_PATH="$DEPLOY_ROOT/.env" \
    NODE_ENV=production \
    MEMENTO_ENV=prod \
    npm run migrations:up:prod || MIGRATION_STATUS=$?
  cd "$DEPLOY_ROOT"
  return "$MIGRATION_STATUS"
}

check_readiness() {
  LABEL="$1"
  ATTEMPTS="${2:-15}"
  ALLOW_LEGACY_HEALTH="${3:-0}"

  echo "Checking ${LABEL}..."

  for attempt in $(seq 1 "$ATTEMPTS"); do
    READINESS_STATUS="$(curl \
      --silent \
      --max-time 5 \
      --output /dev/null \
      --write-out '%{http_code}' \
      "$READINESS_URL" \
      2>/dev/null || true)"

    case "$READINESS_STATUS" in
    2??)
      echo "${LABEL} passed on attempt ${attempt}"
      return 0
      ;;
    esac

    if [ "$ALLOW_LEGACY_HEALTH" = "1" ] && \
      { [ "$READINESS_STATUS" = "404" ] || \
        [ "$READINESS_STATUS" = "405" ]; } && curl \
      --fail \
      --silent \
      --show-error \
      --max-time 5 \
      "${READINESS_URL%/ready}/health" \
      >/dev/null 2>&1
    then
      echo "${LABEL} passed via legacy health endpoint on attempt ${attempt}"
      return 0
    fi

    echo "${LABEL} attempt ${attempt} failed"
    sleep 2
  done

  echo "${LABEL} failed"
  return 1
}

# ────────────────────────────────────────────────────
# First-time migration from old in-place deployment
# ────────────────────────────────────────────────────
if [ ! -L "$CURRENT" ]; then
  if [ -e "$CURRENT" ]; then
    echo "ERROR: $CURRENT exists but is not a symlink"
    exit 1
  fi

  LEGACY_RELEASE="$RELEASES/legacy-$(date +%Y%m%d-%H%M%S)"
  LEGACY_FOUND=0

  mkdir -p "$LEGACY_RELEASE"

  for item in \
    build \
    node_modules \
    package.json \
    yarn.lock \
    ecosystem.config.js \
    .nvmrc
  do
    if [ -e "$DEPLOY_ROOT/$item" ] || \
       [ -L "$DEPLOY_ROOT/$item" ]; then

      mv \
        "$DEPLOY_ROOT/$item" \
        "$LEGACY_RELEASE/$item"

      LEGACY_FOUND=1
    fi
  done

  if [ "$LEGACY_FOUND" -eq 1 ]; then
    echo "Migrated existing deployment to:"
    echo "  $LEGACY_RELEASE"

    ln -s \
      "$LEGACY_RELEASE" \
      "$CURRENT"
  else
    echo "No previous deployment found."
    rmdir "$LEGACY_RELEASE"
  fi

  # Compatibility paths allow the existing
  # ecosystem.config.js to continue referencing:
  #
  # /opt/memento/backend-prod/build/...
  #
  # even though the actual build lives in:
  #
  # releases/<id>/build/
  ln -sfn \
    "current/build" \
    "$DEPLOY_ROOT/build"

  ln -sfn \
    "current/node_modules" \
    "$DEPLOY_ROOT/node_modules"

  ln -sfn \
    "current/package.json" \
    "$DEPLOY_ROOT/package.json"

  ln -sfn \
    "current/yarn.lock" \
    "$DEPLOY_ROOT/yarn.lock"

  ln -sfn \
    "current/ecosystem.config.js" \
    "$DEPLOY_ROOT/ecosystem.config.js"

  ln -sfn \
    "current/.nvmrc" \
    "$DEPLOY_ROOT/.nvmrc"
fi

# ────────────────────────────────────────────────────
# Validate release layout
# ────────────────────────────────────────────────────
if [ ! -L "$CURRENT" ]; then
  echo "ERROR: current is not a symlink"
  exit 1
fi

if [ ! -L "$DEPLOY_ROOT/build" ]; then
  echo "ERROR: build compatibility symlink is missing"
  exit 1
fi

if [ ! -L "$DEPLOY_ROOT/ecosystem.config.js" ]; then
  echo "ERROR: ecosystem.config.js compatibility symlink is missing"
  exit 1
fi

PREVIOUS_RELEASE="$(
  readlink -f "$CURRENT" || true
)"

echo
echo "Previous release:"
echo "  ${PREVIOUS_RELEASE:-none}"

echo "New release:"
echo "  $NEW_RELEASE"

# Set to 1 immediately before calling PM2.
#
# PM2 may partially reload one process and then fail,
# so rollback must assume processes were touched once
# the operation begins.
PM2_RELOAD_ATTEMPTED=0

rollback() {
  echo
  echo "Production deployment failed."

  if [ -z "$PREVIOUS_RELEASE" ]; then
    echo "ERROR: No previous release available."
    return 1
  fi

  if [ ! -d "$PREVIOUS_RELEASE" ]; then
    echo "ERROR: Previous release no longer exists:"
    echo "  $PREVIOUS_RELEASE"
    return 1
  fi

  echo "Restoring current symlink:"
  echo "  $PREVIOUS_RELEASE"

  if ! switch_release "$PREVIOUS_RELEASE"; then
    echo "ERROR: Failed restoring previous symlink."
    return 1
  fi

  # If PM2 wasn't touched, the original production
  # processes are still running. Reloading them would
  # only introduce another possible failure.
  if [ "$PM2_RELOAD_ATTEMPTED" -eq 0 ]; then
    echo "PM2 was not modified."
    echo "Existing production processes remain running."
    echo "Symlink rollback completed."
    return 0
  fi

  echo "PM2 was modified; reloading previous release..."

  if ! use_release_node "$PREVIOUS_RELEASE"; then
    echo "ERROR: Symlink restored but PM2 control runtime failed."
    return 1
  fi

  if ! reload_apps; then
    echo "ERROR: Symlink restored but PM2 rollback failed."
    return 1
  fi

  if ! check_readiness "Rollback readiness check" 15 1; then
    echo "ERROR: Previous release restored but readiness check failed."
    return 1
  fi

  echo "Production rollback completed successfully."
  return 0
}

# ────────────────────────────────────────────────────
# Activate
# ────────────────────────────────────────────────────
echo
echo "Activating new production release..."

# This should succeed because Prepare release runtime
# already provisioned Node + PM2 before activation.
if ! use_release_node "$NEW_RELEASE"; then
  exit 1
fi

if ! run_release_migrations; then
  echo "ERROR: Release database migrations failed."
  exit 1
fi

if ! switch_release "$NEW_RELEASE"; then
  echo "ERROR: Failed activating new release."
  exit 1
fi

PM2_RELOAD_ATTEMPTED=1

if ! reload_apps; then
  rollback || true
  exit 1
fi

# ────────────────────────────────────────────────────
# Readiness check
# ────────────────────────────────────────────────────
if ! check_readiness "Production readiness check" 15; then
  rollback || true
  exit 1
fi

echo
echo "Production deployment successful."
echo "Active release:"
echo "  $NEW_RELEASE"

# Growth analytics settings: warn (never fail) when PostHog
# tracking is off or mis-tagged, so signups can't go missing silently.
(
  cd "$NEW_RELEASE" &&
    DOTENV_CONFIG_PATH="$DEPLOY_ROOT/.env" \
    NODE_ENV=production \
    MEMENTO_ENV=prod \
    node build/src/scripts/growth-analytics/check-config.js --github
) || echo "::warning::Could not check growth analytics settings"

# ────────────────────────────────────────────────────
# Cleanup
#
# Keep latest 5 normal releases.
# Keep legacy releases as an additional migration
# safety net.
# ────────────────────────────────────────────────────
mapfile -t OLD_RELEASES < <(
  find "$RELEASES" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    ! -name 'legacy-*' \
    -printf '%T@ %p\n' \
    | sort -rn \
    | awk '
        NR > 5 {
          $1 = ""
          sub(/^ /, "")
          print
        }
      '
)

ACTIVE_RELEASE="$(
  readlink -f "$CURRENT" || true
)"

for old_release in "${OLD_RELEASES[@]}"; do
  if [ "$old_release" = "$ACTIVE_RELEASE" ]; then
    continue
  fi

  echo "Removing old release:"
  echo "  $old_release"

  rm -rf "$old_release"
done
