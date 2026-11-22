set -euo pipefail

RELEASE_ID="$1"

DEPLOY_ROOT="/opt/memento/backend-dev"
RELEASE_DIR="$DEPLOY_ROOT/releases/$RELEASE_ID"
CURRENT="$DEPLOY_ROOT/current"

if [ ! -d "$RELEASE_DIR" ]; then
  echo "Failed release is already absent."
  exit 0
fi

ACTIVE_RELEASE="$(
  readlink -f "$CURRENT" 2>/dev/null || true
)"

RELEASE_PATH="$(
  readlink -f "$RELEASE_DIR" 2>/dev/null || true
)"

if [ -n "$RELEASE_PATH" ] && \
   [ "$RELEASE_PATH" = "$ACTIVE_RELEASE" ]; then

  echo "Failed release is still active."
  echo "Refusing to delete:"
  echo "  $RELEASE_DIR"

  exit 0
fi

echo "Removing failed inactive release:"
echo "  $RELEASE_DIR"

rm -rf "$RELEASE_DIR"
