#!/usr/bin/env bash
# Test backend only. The caller must serialize this with the standard dev deploy job.
set -euo pipefail
root=/opt/memento/backend-dev
expected_release="$1"
runtime_revision=854530ee42ef5bba272375d5df5dc99a5ef8ee58
owner=6862b52743becb3f572df197
[[ "$expected_release" =~ ^[0-9a-f]{40}$ ]]
case "$(readlink -f "$root/current")" in "$root/releases/$expected_release-"*) ;; *) echo 'Expected test release is not active' >&2; exit 1;; esac
test -f "$root/current/build/src/module/api/memory/search.js"
test -f "$root/.env"
test ! -L "$root/.env"
runtime="$root/search-runtime/$runtime_revision"
models="$root/search-models/bfcd298762cc34d0357ece5ebdd31791a3a374d8"
test "$(cat "$runtime/MEMENTO_VERIFIED")" = "$runtime_revision"

export NVM_DIR="$HOME/.nvm"
set +u
. "$NVM_DIR/nvm.sh"
cd "$root/current"
nvm use >/dev/null
set -u
cd "$root"
pm2 describe memento-backend-dev >/dev/null
pm2 describe memento-backend-dev-worker >/dev/null
if [ "$(id -u)" != 0 ]; then test "$(stat -c %u "$root/.env")" = "$(id -u)"; fi

reload_apps() {
  local app
  for app in memento-backend-dev memento-backend-dev-worker; do
    # Give PM2 the intended environment at launch instead of depending on
    # ecosystem dotenv changes propagating into PM2's environment merge.
    # Defaults clear sticky keys when rolling back to a file without them.
    node - "$root" "$app" <<'NODE' || return 1
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const [root, app] = process.argv.slice(2);
const {parseEnv} = require('node:util');
const env = {
  ...process.env,
  MEMORY_SEARCH_ENABLED: 'false',
  MEMORY_SEARCH_USER_IDS: '',
  MEMORY_SEARCH_DIGUP_PATH: '',
  MEMORY_SEARCH_MODELS_DIR: '',
  MEMORY_SEARCH_PHOTOS_ENABLED: 'true',
  ...parseEnv(fs.readFileSync(root + '/.env', 'utf8')),
  MEMENTO_ENV: 'dev',
};
const result = spawnSync('pm2', ['startOrReload', root + '/ecosystem.config.js', '--only', app, '--update-env'], {env, stdio: 'inherit'});
process.exit(result.status ?? 1);
NODE
  done
}
wait_ready() {
  for attempt in $(seq 1 20); do
    if curl --silent --fail --connect-timeout 2 --max-time 4 http://127.0.0.1:3001/ready >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
wait_ready
umask 077
backup=$(mktemp "$root/.search-env-backup.XXXXXX")
cp -p -- "$root/.env" "$backup"
chmod 600 "$backup"
changed=0
cleanup() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$changed" = 1 ]; then
    echo 'Pilot activation failed; restoring previous test settings' >&2
    if ! cp -p -- "$backup" "$root/.env"; then
      echo 'Settings restoration failed; private backup retained on server' >&2
      exit 1
    fi
    if ! reload_apps || ! wait_ready; then
      echo 'Previous settings restored but readiness failed; private backup retained on server' >&2
      exit 1
    fi
  fi
  rm -f -- "$backup"
  exit "$status"
}
trap cleanup EXIT
changed=1
python3 - "$root/.env" "$owner" "$runtime/digup" "$models" <<'PY'
from pathlib import Path
import os
import re
import sys
import tempfile

path = Path(sys.argv[1])
metadata = path.stat()
values = {
    'MEMORY_SEARCH_ENABLED': 'true',
    'MEMORY_SEARCH_USER_IDS': sys.argv[2],
    'MEMORY_SEARCH_DIGUP_PATH': sys.argv[3],
    'MEMORY_SEARCH_MODELS_DIR': sys.argv[4],
    'MEMORY_SEARCH_PHOTOS_ENABLED': 'false',
}
pattern = re.compile(r'^\s*(?:export\s+)?(' + '|'.join(values) + r')\s*=')
content = ''.join(line for line in path.read_text().splitlines(keepends=True) if not pattern.match(line))
if content and not content.endswith('\n'):
    content += '\n'
content += '\n# Description search test pilot\n' + ''.join(f'{key}={value}\n' for key, value in values.items())
temporary = None
try:
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.search-env-next-', delete=False) as output:
        temporary = Path(output.name)
        os.fchmod(output.fileno(), 0o600)
        os.fchown(output.fileno(), metadata.st_uid, metadata.st_gid)
        output.write(content)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)
finally:
    if temporary:
        temporary.unlink(missing_ok=True)
PY
reload_apps
wait_ready
pm2 jlist | node -e '
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  try {
  const names = ["memento-backend-dev", "memento-backend-dev-worker"];
  const apps = JSON.parse(input);
  const expected = {
    MEMORY_SEARCH_ENABLED: "true",
    MEMORY_SEARCH_USER_IDS: process.argv[1],
    MEMORY_SEARCH_DIGUP_PATH: process.argv[2],
    MEMORY_SEARCH_MODELS_DIR: process.argv[3],
    MEMORY_SEARCH_PHOTOS_ENABLED: "false",
  };
  for (const name of names) {
    const app = apps.find(item => item.name === name);
    const env = {...app?.pm2_env?.env, ...app?.pm2_env};
    if (env.status !== "online" || !Object.entries(expected).every(([key,value]) => env[key] === value)) {
      console.error("Effective test-process pilot settings did not match; activation rejected");
      process.exitCode = 1;
    }
  }
  } catch {
    console.error("Could not verify effective test-process settings; activation rejected");
    process.exitCode = 1;
  }
});
' "$owner" "$runtime/digup" "$models"
pm2 save
echo 'Text description search enabled for the selected test owner; test API and worker are ready'
