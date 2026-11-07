#!/usr/bin/env bash
# Saves a secret to api/.env without it appearing on screen, in shell history
# or in the process list.
#
#   yarn env:set DEEPSEEK_API_KEY
#
# Replaces the line if the variable is already set, otherwise appends it.
# For DEEPSEEK_API_KEY it also checks the key with DeepSeek (listing models
# costs nothing). Restart the API afterwards so it reads the new value.
set -euo pipefail

name="${1:-}"
if [[ ! "$name" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
  echo "Usage: yarn env:set VARIABLE_NAME   (for example DEEPSEEK_API_KEY)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
env_file=".env"
touch "$env_file"

read -r -s -p "Paste the value for $name, then press Enter: " value
echo
if [[ -z "$value" ]]; then
  echo "Nothing entered; $env_file was not changed." >&2
  exit 1
fi
value="$(printf '%s' "$value" | tr -d '\r\n')"

if [[ "$name" == "DEEPSEEK_API_KEY" ]]; then
  status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -H @<(printf 'Authorization: Bearer %s\n' "$value") \
    https://api.deepseek.com/v1/models || true)"
  if [[ "$status" == "401" || "$status" == "403" ]]; then
    echo "DeepSeek rejected that key (HTTP $status); $env_file was not changed." >&2
    exit 1
  elif [[ "$status" == "200" ]]; then
    echo "DeepSeek accepted the key."
  else
    echo "Could not check the key with DeepSeek (HTTP ${status:-none}); saving it anyway."
  fi
fi

# Rewritten by Node so any characters in the value are kept exactly. The
# value travels in the environment, never as a command-line argument.
ENV_FILE="$env_file" ENV_NAME="$name" ENV_VALUE="$value" node -e '
const fs = require("fs");
const {ENV_FILE: file, ENV_NAME: name, ENV_VALUE: value} = process.env;
const line = `${name}=${value}`;
const lines = fs.readFileSync(file, "utf8").split("\n");
const at = lines.findIndex(l => l.startsWith(`${name}=`));
if (at >= 0) lines[at] = line;
else {
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  lines.push(line, "");
}
const temp = `${file}.tmp`;
fs.writeFileSync(temp, lines.join("\n"), {mode: 0o600});
fs.renameSync(temp, file);
console.log(`${at >= 0 ? "Updated" : "Added"} ${name} in ${file}.`);
'
echo "Restart the API (npm run dev / pm2 restart) so it uses the new value."
