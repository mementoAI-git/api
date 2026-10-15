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
   ```

5. `cp memento-embed.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now memento-embed`
6. Check: `journalctl -u memento-embed -f` shows `engine_ready` with its load
   time; from the API box,
   `curl -s -H "Authorization: Bearer $TOKEN" http://<private-ip>:8790/health`.

## Point the API at it

In the API and worker `.env` (both processes), then restart them:

```dotenv
MEMORY_SEARCH_ENGINE_URL=http://<private-ip>:8790
MEMORY_SEARCH_ENGINE_TOKEN=<same token>
```

`MEMORY_SEARCH_ENABLED` and `MEMORY_SEARCH_USER_IDS` still decide who gets
description search.
