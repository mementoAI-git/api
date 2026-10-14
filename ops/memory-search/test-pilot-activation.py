"""Exercise PM2's environment merge and partial-reload failures without services."""
from pathlib import Path
import json
import subprocess
import unittest
import tempfile
import os

script = Path(__file__).with_name("activate-pilot.sh").read_text()
reload_function = "reload_apps() {" + script.split("reload_apps() {", 1)[1].split("\nwait_ready()", 1)[0]
environment_guard = script.split("pm2 jlist | node -e '\n", 1)[1].split("\n' \"$owner\"", 1)[0]


class ActivationRecoveryTests(unittest.TestCase):
    def reload(self, settings, fail_api=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.env').write_text(settings)
            binary = root / 'pm2'
            binary.write_text(r"""#!/usr/bin/env node
const fs = require('node:fs');
const app = process.argv[process.argv.indexOf('--only') + 1];
fs.appendFileSync(process.env.CALLS, JSON.stringify({app, enabled:process.env.MEMORY_SEARCH_ENABLED, owner:process.env.MEMORY_SEARCH_USER_IDS, photos:process.env.MEMORY_SEARCH_PHOTOS_ENABLED, environment:process.env.MEMENTO_ENV}) + '\n');
if (process.env.FAIL_API === 'yes' && app === 'memento-backend-dev') process.exit(42);
""")
            binary.chmod(0o700)
            calls = root / 'calls'
            env = dict(os.environ, PATH=str(root) + os.pathsep + os.environ['PATH'], CALLS=str(calls), FAIL_API='yes' if fail_api else 'no', MEMORY_SEARCH_ENABLED='stale', MEMORY_SEARCH_USER_IDS='stale')
            command = 'set -euo pipefail\nroot="$1"\n' + reload_function + '\nreload_apps'
            result = subprocess.run(['bash', '-c', command, 'test', str(root)], env=env, capture_output=True, text=True)
            records = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            return result, records

    def test_missing_prior_settings_explicitly_reset_pm2_values(self):
        result, calls = self.reload('')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual((call['enabled'], call['owner'], call['photos'], call['environment']), ('false', '', 'true', 'dev'))

    def test_current_settings_reach_pm2_before_it_loads_ecosystem(self):
        result, calls = self.reload('MEMORY_SEARCH_ENABLED=true\nMEMORY_SEARCH_USER_IDS=test-owner\nMEMORY_SEARCH_PHOTOS_ENABLED=false\n')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 2)
        for call in calls:
            self.assertEqual((call['enabled'], call['owner'], call['photos']), ('true', 'test-owner', 'false'))

    def test_api_failure_is_not_hidden_by_a_successful_worker_reload(self):
        result, calls = self.reload('', fail_api=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([call['app'] for call in calls], ['memento-backend-dev'])

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
