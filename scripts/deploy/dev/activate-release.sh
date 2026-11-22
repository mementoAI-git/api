set -euo pipefail

RELEASE_ID="$1"

DEPLOY_ROOT="/opt/memento/backend-dev"
RELEASES="$DEPLOY_ROOT/releases"
CURRENT="$DEPLOY_ROOT/current"
NEW_RELEASE="$RELEASES/$RELEASE_ID"

API_APP="memento-backend-dev"
WORKER_APP="memento-backend-dev-worker"

READINESS_URL="http://127.0.0.1:3001/ready"

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
  set -u
}

use_release_node() {
  RELEASE_DIR="$1"

  load_nvm || return 1

  OLD_PWD="$PWD"
  cd "$RELEASE_DIR"

  if [ -f ".nvmrc" ]; then
    echo "Selecting Node from:"
    echo "  $RELEASE_DIR/.nvmrc"

    set +u

    if nvm use; then
      NVM_OK=1
    else
      NVM_OK=0
    fi

    set -u

    if [ "$NVM_OK" -ne 1 ]; then
      cd "$OLD_PWD"
      echo "ERROR: Unable to select release Node version"
      return 1
    fi

  else
    # Legacy migration releases may not contain
    # .nvmrc. Use the new release's Node version as
    # the PM2 control runtime in that situation.
    echo "WARNING: Release has no .nvmrc:"
    echo "  $RELEASE_DIR"
    echo "Using deployment Node as PM2 control runtime."

    cd "$NEW_RELEASE"

    set +u

    if nvm use >/dev/null 2>&1; then
      NVM_OK=1
    else
      NVM_OK=0
    fi

    set -u

    if [ "$NVM_OK" -ne 1 ]; then
      cd "$OLD_PWD"
      echo "ERROR: Unable to select deployment Node"
      return 1
    fi
  fi

  cd "$OLD_PWD"

  # A historical release may reference a Node version
  # where PM2 was never installed. Fall back to the new
  # release's Node version, where Prepare runtime has
  # already guaranteed PM2 exists.
  if ! command -v pm2 >/dev/null 2>&1; then
    echo "PM2 unavailable under selected Node."
    echo "Using deployment Node as PM2 control runtime."

    cd "$NEW_RELEASE"

    set +u

    if nvm use >/dev/null 2>&1; then
      NVM_OK=1
    else
      NVM_OK=0
    fi

    set -u

    cd "$OLD_PWD"

    if [ "$NVM_OK" -ne 1 ]; then
      echo "ERROR: Could not select deployment Node"
      return 1
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: Node is unavailable"
    return 1
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "ERROR: PM2 is unavailable"
    return 1
  fi

  echo "Control Node: $(node --version)"
  echo "PM2: $(command -v pm2)"
}

switch_release() {
  TARGET="$1"

  if [ ! -d "$TARGET" ]; then
    echo "ERROR: Cannot switch to missing release:"
    echo "  $TARGET"
    return 1
  fi

  rm -f "$DEPLOY_ROOT/.current-next"

  ln -s \
    "$TARGET" \
    "$DEPLOY_ROOT/.current-next"

  # Atomic rename on the same filesystem.
  mv -Tf \
    "$DEPLOY_ROOT/.current-next" \
    "$CURRENT"
}

reload_apps() {
  cd "$DEPLOY_ROOT"

  echo "Reloading API..."

  MEMENTO_ENV=dev \
    pm2 startOrReload \
    "$DEPLOY_ROOT/ecosystem.config.js" \
    --only "$API_APP" \
    --update-env

  echo "Reloading worker..."

  MEMENTO_ENV=dev \
    pm2 startOrReload \
    "$DEPLOY_ROOT/ecosystem.config.js" \
    --only "$WORKER_APP" \
    --update-env

  pm2 save

  echo "PM2 reload completed."
}

run_release_migrations() {
  echo "Running release database migrations..."
  cd "$NEW_RELEASE"
  MIGRATION_STATUS=0
  DOTENV_CONFIG_PATH="$DEPLOY_ROOT/.env" \
    NODE_ENV=production \
    MEMENTO_ENV=dev \
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
# One-time migration from the old in-place deployment
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
    echo "No existing deployment found."
    rmdir "$LEGACY_RELEASE"
  fi

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

# Validate the migrated/current structure.
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

# The currently-running release is known-good enough to
# be serving traffic, so mark it healthy.
#
# This also migrates deployments created before the
# .healthy-marker system.
if [ -n "$PREVIOUS_RELEASE" ] && \
   [ -d "$PREVIOUS_RELEASE" ]; then

  touch "$PREVIOUS_RELEASE/.healthy"
fi

PM2_RELOAD_ATTEMPTED=0

rollback() {
  echo
  echo "Development deployment failed."

  if [ -z "$PREVIOUS_RELEASE" ]; then
    echo "ERROR: No previous release is available."
    return 1
  fi

  if [ ! -d "$PREVIOUS_RELEASE" ]; then
    echo "ERROR: Previous release no longer exists:"
    echo "  $PREVIOUS_RELEASE"
    return 1
  fi

  echo "Restoring previous release:"
  echo "  $PREVIOUS_RELEASE"

  if ! switch_release "$PREVIOUS_RELEASE"; then
    echo "ERROR: Failed restoring previous symlink."
    return 1
  fi

  # If PM2 was never touched, the previous processes
  # are still running. Do not unnecessarily restart
  # them.
  if [ "$PM2_RELOAD_ATTEMPTED" -eq 0 ]; then
    echo "PM2 was never modified."
    echo "Existing processes remain running."
    echo "Symlink rollback completed."
    return 0
  fi

  echo "PM2 was modified; restoring previous processes."

  if ! use_release_node "$PREVIOUS_RELEASE"; then
    echo "ERROR: Symlink restored, but PM2 control failed."
    return 1
  fi

  if ! reload_apps; then
    echo "ERROR: Symlink restored, but PM2 rollback failed."
    return 1
  fi

  if ! check_readiness "Rollback readiness check" 10 1; then
    echo "ERROR: Previous release is still not ready."
    return 1
  fi

  echo "Rollback completed successfully."
}

# ────────────────────────────────────────────────────
# Activate new release
# ────────────────────────────────────────────────────
echo
echo "Activating new release..."

# PM2 was guaranteed to exist for this Node version
# during Prepare release runtime.
if ! use_release_node "$NEW_RELEASE"; then
  exit 1
fi

if ! run_release_migrations; then
  echo "ERROR: Release database migrations failed"
  exit 1
fi

if ! switch_release "$NEW_RELEASE"; then
  echo "ERROR: Unable to activate new release"
  exit 1
fi

# Mark before invoking PM2 because startOrReload could
# partially modify one process and then fail.
PM2_RELOAD_ATTEMPTED=1

if ! reload_apps; then
  rollback || true
  exit 1
fi

if ! check_readiness "New release readiness check" 15; then
  rollback || true
  exit 1
fi

# Only a release that passed its readiness check receives
# this marker.
touch "$NEW_RELEASE/.healthy"

echo
echo "Deployment successful."
echo "Active release:"
echo "  $NEW_RELEASE"

# Growth analytics settings: warn (never fail) when PostHog
# tracking is off or mis-tagged, so signups can't go missing silently.
(
  cd "$NEW_RELEASE" &&
    DOTENV_CONFIG_PATH="$DEPLOY_ROOT/.env" \
    NODE_ENV=production \
    MEMENTO_ENV=dev \
    node build/src/scripts/growth-analytics/check-config.js --github
) || echo "::warning::Could not check growth analytics settings"

# ────────────────────────────────────────────────────
# Release cleanup
#
# 1. Delete failed/incomplete normal releases.
# 2. Keep only TWO healthy normal releases:
#      - current
#      - previous
#
# Legacy migration release is retained separately for
# now.
# ────────────────────────────────────────────────────
ACTIVE_RELEASE="$(
  readlink -f "$CURRENT" || true
)"

echo
echo "Removing failed/incomplete releases..."

for candidate in "$RELEASES"/*; do
  [ -d "$candidate" ] || continue

  NAME="$(basename "$candidate")"

  case "$NAME" in
    legacy-*)
      continue
      ;;
  esac

  if [ "$candidate" = "$ACTIVE_RELEASE" ]; then
    continue
  fi

  if [ ! -f "$candidate/.healthy" ]; then
    echo "Removing unhealthy/incomplete release:"
    echo "  $candidate"

    rm -rf "$candidate"
  fi
done

echo
echo "Keeping newest 2 healthy releases..."

mapfile -t HEALTHY_RELEASES < <(
  for candidate in "$RELEASES"/*; do
    [ -d "$candidate" ] || continue

    NAME="$(basename "$candidate")"

    case "$NAME" in
      legacy-*)
        continue
        ;;
    esac

    [ -f "$candidate/.healthy" ] || continue

    printf '%s %s\n' \
      "$(stat -c '%Y' "$candidate")" \
      "$candidate"
  done |
    sort -rn |
    cut -d' ' -f2-
)

if [ "${#HEALTHY_RELEASES[@]}" -gt 2 ]; then
  for old_release in "${HEALTHY_RELEASES[@]:2}"; do
    if [ "$old_release" = "$ACTIVE_RELEASE" ]; then
      continue
    fi

    echo "Removing old healthy release:"
    echo "  $old_release"

    rm -rf "$old_release"
  done
fi

echo
echo "Remaining releases:"
du -sh "$RELEASES"/* 2>/dev/null || true
