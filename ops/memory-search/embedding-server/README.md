# Embedding server

Keeps EmbeddingGemma 2 (through the verified DigUp worker) loaded on its own
machine, so description search and voice memory search do not reload the
model for every query. The API and workers call it over the Hetzner private
network when `MEMORY_SEARCH_ENGINE_URL` is set; without it they spawn DigUp
locally as before. When the server is down, search falls back to words.

## Machine

- x86_64 (the verified DigUp build is `linux-amd64`), same Hetzner location
  as the API, attached to the same private network.
- Port 8790 reachable **only** from the private network: Hetzner Cloud
  firewall with no public inbound except SSH, and `ufw` allowing 8790 from the
  private subnet only.
- Inputs (story text) pass through in memory only; nothing is logged but
  counts and timings.

## How dev reaches it (15 Oct 2026)

Neither server has a Hetzner private network, so they are joined by a
WireGuard tunnel: embedding box `wg0` 10.77.0.1, API box `wg0` 10.77.0.2
(`/etc/wireguard/wg0.conf` on each, `wg-quick@wg0` enabled). UFW allows
51820/udp only from the other box's public IP, and 8790/tcp only on `wg0`
from 10.77.0.2. The service listens on 10.77.0.1 and starts after the
tunnel (`memento-embed.service.d/wireguard.conf`). Round trip from the API
box: ~1.2 ms ping, 113–147 ms per search query.

## Install

1. Node 20+: `apt install nodejs` from NodeSource, `node -v`.
2. `useradd --system --home /opt/memento-embed --shell /usr/sbin/nologin memento-embed`
3. Put the verified runtime and models (the same artifacts and checksums the
   dev pilot uses; see `agents/memory-search-trial.md` and
   `.github/workflows/memory-search-pilot.yml`) under
   `/opt/memento-embed/runtime/<revision>/` and
   `/opt/memento-embed/models/bfcd298762cc34d0357ece5ebdd31791a3a374d8/`, and
   `server.mjs` at `/opt/memento-embed/server.mjs`. Owned by root, readable by
   `memento-embed`.
4. `/etc/memento-embed.env` (mode 600, root):

   ```dotenv
   DIGUP_PATH=/opt/memento-embed/runtime/<revision>/digup
   DIGUP_MODELS=/opt/memento-embed/models/bfcd298762cc34d0357ece5ebdd31791a3a374d8
   EMBEDDING_SERVER_TOKEN=<openssl rand -hex 32>
   EMBEDDING_SERVER_HOST=<this machine's private IP>
   EMBEDDING_SERVER_PORT=8790
   EMBEDDING_TEXT_ONLY=true
   EMBEDDING_QUERY_THREADS=2
   EMBEDDING_INDEX_THREADS=2
   ```

   The two thread counts should add up to the core count, no more.

5. `cp memento-embed.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now memento-embed`
6. Check: `journalctl -u memento-embed -f` shows `engine_ready` with its load
   time; from the API box,
   `curl -s -H "Authorization: Bearer $TOKEN" http://<private-ip>:8790/health`.

## Deploying changes

Changes to `server.mjs` or the unit deploy from `dev` through
`.github/workflows/deploy-embedding-server.yml` (also runnable by hand). It
tests the server, then pipes the two files over SSH to the box. The CI key
(secrets `EMBED_SSH_KEY`, `EMBED_SSH_KNOWN_HOSTS`, `EMBED_SSH_HOST`) is
pinned in root's `authorized_keys` to
`command="/usr/local/sbin/memento-embed-deploy"` with no pty or forwarding,
so it can only run `deploy.sh`: install, restart, check `/health`, and
restore the previous version if it is not healthy. Changes to `deploy.sh`
itself are installed by hand.

## Point the API at it

In the API and worker `.env` (both processes), then restart them:

```dotenv
MEMORY_SEARCH_ENGINE_URL=http://<private-ip>:8790
MEMORY_SEARCH_ENGINE_TOKEN=<same token>
```

`MEMORY_SEARCH_ENABLED` and `MEMORY_SEARCH_USER_IDS` still decide who gets
description search.

## Measured (4 vCPU Skylake, 7.6 GB, Hetzner nbg1, 15 Oct 2026)

| | |
|---|---|
| DigUp spawned per query (before) | 1.8–2.2 s per query |
| Model load at service start | ~1.7 s per lane, ~465 MB RAM per lane |
| Search query, idle | p50 159 ms, p95 190 ms |
| Search query while indexing | p50 140 ms, p95 160 ms, max 169 ms |
| Indexing, 1,800-character story chunk | ~3.1 s each (8 chunks in 25 s) |
