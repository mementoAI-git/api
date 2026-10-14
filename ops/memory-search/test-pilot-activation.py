"""Exercise PM2's environment merge and partial-reload failures without services."""
from pathlib import Path
import json
import subprocess
import unittest

script = Path(__file__).with_name("activate-pilot.sh").read_text()
reload_function = "reload_apps() {" + script.split("reload_apps() {", 1)[1].split("\nwait_ready()", 1)[0]
environment_guard = script.split("pm2 jlist | node -e '\n", 1)[1].split("\n' \"$owner\"", 1)[0]


class ActivationRecoveryTests(unittest.TestCase):
    def shell(self, mock, assertions):
        result = subprocess.run(["bash", "-c", "set -euo pipefail\nroot=/fictional/backend-dev\n" + mock + "\n" + reload_function + "\n" + assertions], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_missing_prior_settings_explicitly_reset_pm2_values(self):
        self.shell("""
export MEMORY_SEARCH_ENABLED=true MEMORY_SEARCH_USER_IDS=new-owner
export MEMORY_SEARCH_DIGUP_PATH=/new/engine MEMORY_SEARCH_MODELS_DIR=/new/models
calls=0
pm2() {
  test "$MEMORY_SEARCH_ENABLED" = false || return 93
  test -z "$MEMORY_SEARCH_USER_IDS" || return 93
  test -z "$MEMORY_SEARCH_DIGUP_PATH" || return 93
  test -z "$MEMORY_SEARCH_MODELS_DIR" || return 93
  test "$MEMORY_SEARCH_PHOTOS_ENABLED" = true || return 93
  test "$MEMENTO_ENV" = dev || return 93
  calls=$((calls + 1))
}
""", "reload_apps\ntest \"$calls\" = 2")

    def test_api_failure_is_not_hidden_by_a_successful_worker_reload(self):
        self.shell("""
worker_called=0
pm2() {
  if [[ "$*" == *'--only memento-backend-dev-worker '* ]]; then
    worker_called=1
    return 0
  fi
  return 42
}
""", "if reload_apps; then exit 1; fi\ntest \"$worker_called\" = 0")

    def guard(self, data):
        return subprocess.run(["node", "-e", environment_guard, "test-owner", "/test/digup", "/test/models"], input=data, capture_output=True, text=True)

    def processes(self):
        return [{"name": name, "pm2_env": {
            "status": "online", "MEMORY_SEARCH_ENABLED": "true",
            "MEMORY_SEARCH_USER_IDS": "test-owner", "MEMORY_SEARCH_DIGUP_PATH": "/test/digup",
            "MEMORY_SEARCH_MODELS_DIR": "/test/models", "MEMORY_SEARCH_PHOTOS_ENABLED": "false",
        }} for name in ("memento-backend-dev", "memento-backend-dev-worker")]

    def test_effective_process_guard_requires_both_configured_apps(self):
        apps = self.processes()
        self.assertEqual(self.guard(json.dumps(apps)).returncode, 0)
        apps[1]["pm2_env"]["MEMORY_SEARCH_ENABLED"] = "false"
        self.assertNotEqual(self.guard(json.dumps(apps)).returncode, 0)
        self.assertNotEqual(self.guard(json.dumps(apps[:1])).returncode, 0)

    def test_invalid_process_response_is_rejected_without_echoing_it(self):
        result = self.guard("private-test-data-not-valid-json")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("private-test-data", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()
