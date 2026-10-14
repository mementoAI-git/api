#!/usr/bin/env python3
"""Check a native helper with fictional text, without application credentials."""
import base64
import json
import math
import os
import struct
import subprocess
import sys
import time

executable, models = sys.argv[1:]
environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
environment["DIGUP_MODELS"] = models
request = json.dumps({"id": 1, "op": "text", "inputs": ["task: search result | query: a family beach holiday"], "budget": 140}) + "\n"
request += json.dumps({"id": 2, "op": "quit"}) + "\n"
for attempt in range(3):
    started = time.monotonic()
    result = subprocess.run([executable, "worker", "--text-only"], input=request, text=True, capture_output=True, env=environment, timeout=3, check=True)
    lines = [json.loads(line) for line in result.stdout.splitlines()]
    ready, reply = lines[:2]
    assert ready["ready"] is True
    expected = {
        "model": "google/embeddinggemma-2",
        "revision": "bfcd298762cc34d0357ece5ebdd31791a3a374d8",
        "runtime": "llama.cpp-vectors1",
        "dtype": "text-q8_0+mmproj-q8_0",
        "dim": 768,
    }
    assert all(ready["info"].get(key) == value for key, value in expected.items())
    assert reply["ok"] is True and reply["id"] == 1 and reply["dim"] == 768
    assert reply["count"] == 1 and reply["errors"] == [None]
    vector = struct.unpack("<768f", base64.b64decode(reply["vectors"], validate=True))
    assert all(math.isfinite(value) for value in vector)
    assert sum(value * value for value in vector) > 0.000001
    print(f"Native query {attempt + 1}: valid vector, {(time.monotonic() - started) * 1000:.0f} ms", flush=True)
