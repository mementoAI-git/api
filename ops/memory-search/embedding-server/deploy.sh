#!/usr/bin/env bash
# Installed on the embedding box as /usr/local/sbin/memento-embed-deploy and
# run only through the CI deploy key's forced command. Reads a tar of
# server.mjs and memento-embed.service on stdin, installs them, restarts the
# service and checks /health; restores the previous version if it is not
# healthy within a minute.
set -euo pipefail
umask 022

root=/opt/memento-embed
unit=/etc/systemd/system/memento-embed.service
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT

# At most 1 MiB: the payload is two small text files.
head -c 1048576 | tar -xf - -C "$stage" --no-same-owner --no-same-permissions \
  server.mjs memento-embed.service
node --check "$stage/server.mjs"
grep -q '^ExecStart=/usr/bin/node /opt/memento-embed/server.mjs$' \
  "$stage/memento-embed.service"

healthy() {
  local token host port
  token=$(grep '^EMBEDDING_SERVER_TOKEN=' /etc/memento-embed.env | cut -d= -f2)
  host=$(grep '^EMBEDDING_SERVER_HOST=' /etc/memento-embed.env | cut -d= -f2)
  port=$(grep '^EMBEDDING_SERVER_PORT=' /etc/memento-embed.env | cut -d= -f2)
  for _ in $(seq 1 30); do
    if curl -sf -m 2 -o /dev/null -H "Authorization: Bearer $token" \
      "http://${host:-127.0.0.1}:${port:-8790}/health"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

cp -p "$root/server.mjs" "$root/server.mjs.prev"
cp -p "$unit" "$unit.prev"
install -m 644 -o root -g memento-embed "$stage/server.mjs" "$root/server.mjs"
install -m 644 "$stage/memento-embed.service" "$unit"
systemctl daemon-reload
systemctl restart memento-embed

if healthy; then
  echo "deployed: $(sha256sum "$root/server.mjs" | cut -c1-12), healthy"
  exit 0
fi

echo 'not healthy; restoring the previous version' >&2
install -m 644 -o root -g memento-embed "$root/server.mjs.prev" "$root/server.mjs"
install -m 644 "$unit.prev" "$unit"
systemctl daemon-reload
systemctl restart memento-embed
healthy && echo 'previous version restored and healthy' >&2
exit 1
